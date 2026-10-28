import Foundation
import Capacitor
import Photos
import Vision
import UIKit
import AVFoundation

// Нативная часть импорта слипов: поиск в Фото, распознавание текста и QR (Apple Vision,
// на устройстве), сканер QR и входящие из расширения «Поделиться». Разбор смысла — в src/lib/slips.js.
@objc(SlipScannerPlugin)
public class SlipScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SlipScannerPlugin"
    public let jsName = "Capture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "photoAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanQr", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
    ]

    static let appGroup = "group.com.kazimandrei.coupleexpenses"
    private let work = DispatchQueue(label: "slip-scanner", qos: .userInitiated)

    // MARK: - Доступ к Фото

    private func statusString(_ s: PHAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc func photoAccess(_ call: CAPPluginCall) {
        let current = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard call.getBool("request") == true, current == .notDetermined else {
            call.resolve(["status": statusString(current)])
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            call.resolve(["status": self.statusString(status)])
        }
    }

    // MARK: - Поиск слипов в Фото

    @objc func scanPhotos(_ call: CAPPluginCall) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.resolve(["status": statusString(status), "items": []])
            return
        }
        let sinceMs = call.getDouble("sinceMs") ?? Date().addingTimeInterval(-3 * 86400).timeIntervalSince1970 * 1000
        let limit = max(1, min(call.getInt("limit") ?? 40, 200))
        work.async {
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@",
                                            PHAssetMediaType.image.rawValue,
                                            Date(timeIntervalSince1970: sinceMs / 1000) as NSDate)
            // От старых к новым: processedUntil — дата последнего реально просмотренного фото.
            // JS двигает «since» только до неё, поэтому недосмотренное не теряется.
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
            options.fetchLimit = limit
            let assets = PHAsset.fetchAssets(with: options)
            var items: [[String: Any]] = []
            var processedUntil: Double = sinceMs
            var processed = 0
            let started = Date()
            assets.enumerateObjects { asset, _, stop in
                // Не держим JS дольше 25 с: остальное досмотрим при следующей проверке
                if Date().timeIntervalSince(started) > 25 { stop.pointee = true; return }
                let created = (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000
                processedUntil = max(processedUntil, created)
                processed += 1
                guard let image = self.loadImage(asset, maxSide: 1600) else { return }
                // Сначала дешёвые проверки: QR проверки (есть почти на всех тайских слипах),
                // скриншот или быстрый поиск слов «฿ / THB / Amount / PromptPay» без тайского.
                // Полное распознавание — только для прошедших; обычные фото не трогаем.
                let codes = SlipVision.detectQr(image)
                let isScreenshot = asset.mediaSubtypes.contains(.photoScreenshot)
                guard !codes.isEmpty || isScreenshot || SlipVision.looksLikeSlip(image) else { return }
                items.append([
                    "id": asset.localIdentifier,
                    "created": created,
                    "screenshot": isScreenshot,
                    "qr": codes,
                    "lines": SlipVision.recognizeText(image),
                ])
            }
            let complete = processed == assets.count && assets.count < limit
            call.resolve(["status": self.statusString(status), "items": items,
                          "processedUntil": processedUntil, "complete": complete])
        }
    }

    // Асинхронный запрос с тайм-аутом: синхронный вариант навсегда зависал, если приложение
    // уходило в фон посреди сканирования (или фото долго качается из iCloud)
    private func loadImage(_ asset: PHAsset, maxSide: CGFloat, timeout: TimeInterval = 8) -> CGImage? {
        let opts = PHImageRequestOptions()
        opts.isSynchronous = false
        opts.deliveryMode = .highQualityFormat
        opts.resizeMode = .exact
        opts.isNetworkAccessAllowed = true
        let w = CGFloat(asset.pixelWidth), h = CGFloat(asset.pixelHeight)
        let scale = min(1, maxSide / max(w, h, 1))
        let done = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var result: CGImage?
        var finished = false
        let id = PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: w * scale, height: h * scale),
                                                       contentMode: .aspectFit, options: opts) { img, info in
            // highQualityFormat отдаёт результат один раз; на всякий случай пропускаем черновики
            if (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
            lock.lock()
            defer { lock.unlock() }
            guard !finished else { return }
            finished = true
            result = img?.cgImage
            done.signal()
        }
        if done.wait(timeout: .now() + timeout) == .timedOut {
            PHImageManager.default().cancelImageRequest(id)
            lock.lock(); finished = true; lock.unlock()
            return nil
        }
        return result
    }

    @objc func getPhoto(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id required"); return }
        let maxSide = CGFloat(call.getInt("maxSide") ?? 1600)
        work.async {
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
                  let cg = self.loadImage(asset, maxSide: maxSide),
                  let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.8) else {
                call.reject("photo not found")
                return
            }
            call.resolve(["data": data.base64EncodedString()])
        }
    }

    // MARK: - Распознавание произвольной картинки (чек, счёт)

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"),
              let data = Data(base64Encoded: b64.components(separatedBy: ",").last ?? b64),
              let image = UIImage(data: data)?.normalizedCGImage(maxSide: 2200) else {
            call.reject("bad image")
            return
        }
        work.async {
            call.resolve(["qr": SlipVision.detectQr(image), "lines": SlipVision.recognizeText(image)])
        }
    }

    // Показываем поверх того, что уже открыто, — иначе present молча не сработает и промис не ответит
    func topViewController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
        return top
    }

    // MARK: - Сканер QR

    @objc func scanQr(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let present = {
                let vc = QrScannerViewController()
                vc.ru = call.getString("lang") == "ru"
                vc.onResult = { value in
                    call.resolve(value.map { ["value": $0] } ?? ["cancelled": true])
                }
                vc.modalPresentationStyle = .fullScreen
                guard let host = self.topViewController() else { call.resolve(["cancelled": true]); return }
                host.present(vc, animated: true)
            }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: present()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { ok in
                    DispatchQueue.main.async { ok ? present() : call.resolve(["denied": true]) }
                }
            default: call.resolve(["denied": true])
            }
        }
    }

    // MARK: - Входящие из расширения «Поделиться»

    static func inboxURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent("Inbox", isDirectory: true)
    }

    @objc func takeInbox(_ call: CAPPluginCall) {
        work.async {
            guard let dir = Self.inboxURL(),
                  let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
                call.resolve(["items": []])
                return
            }
            var items: [[String: Any]] = []
            for url in files where url.pathExtension.lowercased() == "jpg" {
                guard let data = try? Data(contentsOf: url), let ui = UIImage(data: data),
                      let cg = ui.normalizedCGImage(maxSide: 2200) else {
                    try? FileManager.default.removeItem(at: url)
                    continue
                }
                // Время пишет расширение в имя файла «<ms>-<uuid>.jpg» — без файловых дат (required reason API)
                let created = Double(url.lastPathComponent.split(separator: "-").first ?? "") ?? Date().timeIntervalSince1970 * 1000
                items.append([
                    "id": url.lastPathComponent,
                    "created": created,
                    "data": data.base64EncodedString(),
                    "qr": SlipVision.detectQr(cg),
                    "lines": SlipVision.recognizeText(cg),
                ])
            }
            call.resolve(["items": items])
        }
    }

    @objc func clearInbox(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        let safe = try? NSRegularExpression(pattern: "^[A-Za-z0-9-]+\\.jpg$")
        if let dir = Self.inboxURL() {
            for id in ids where safe?.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(id))
            }
        }
        call.resolve()
    }
}

// MARK: - Vision

enum SlipVision {
    static func detectQr(_ image: CGImage) -> [String] {
        var codes = runBarcodes(image, revision: nil)
        // Новые ревизии детектора на части устройств и в симуляторе падают — пробуем первую
        if codes == nil { codes = runBarcodes(image, revision: VNDetectBarcodesRequestRevision1) }
        let list = codes ?? []
        return Array(NSOrderedSet(array: list)) as? [String] ?? list
    }

    private static func runBarcodes(_ image: CGImage, revision: Int?) -> [String]? {
        let request = VNDetectBarcodesRequest()
        if let revision { request.revision = revision }
        request.symbologies = revision == VNDetectBarcodesRequestRevision1 ? [.QR] : [.qr]
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            return nil
        }
        return (request.results ?? []).compactMap { $0.payloadStringValue }
    }

    // Быстрый (английский) проход: есть ли на картинке признаки платёжного слипа
    static func looksLikeSlip(_ image: CGImage) -> Bool {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        return text.range(of: "฿|THB|baht|amount|promptpay|transfer|payment completed|transaction|ref\\. ?no|truemoney|K PLUS|SCB|krungthai|krungsri",
                          options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func recognizeText(_ image: CGImage) -> [[String: Any]] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        // Тайский Vision понимает с iOS 17; на старых системах остаётся английский
        let wanted = ["th-TH", "en-US"]
        let supported = (try? request.supportedRecognitionLanguages()) ?? ["en-US"]
        request.recognitionLanguages = wanted.filter { supported.contains($0) }
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).compactMap { obs in
            guard let text = obs.topCandidates(1).first?.string else { return nil }
            let b = obs.boundingBox
            // y сверху вниз, как в JS-разборе
            return ["t": text, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]
        }
    }
}

extension UIImage {
    // Учитываем ориентацию фото с камеры и уменьшаем: Vision быстрее, точности хватает
    func normalizedCGImage(maxSide: CGFloat) -> CGImage? {
        let scale = min(1, maxSide / max(size.width, size.height, 1))
        let target = CGSize(width: floor(size.width * scale), height: floor(size.height * scale))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }.cgImage
    }
}

// MARK: - Экран сканера QR

final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onResult: ((String?) -> Void)?
    var ru = false
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "qr-session")
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        if let device = AVCaptureDevice.default(for: .video),
           let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
            }
            let preview = AVCaptureVideoPreviewLayer(session: session)
            preview.videoGravity = .resizeAspectFill
            preview.frame = view.bounds
            view.layer.addSublayer(preview)
        }

        let frame = UIView()
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.9).cgColor
        frame.layer.borderWidth = 3
        frame.layer.cornerRadius = 24
        frame.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(frame)

        let hint = UILabel()
        hint.text = ru ? "Наведите на QR-код оплаты" : "Point at the payment QR code"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 17, weight: .semibold)
        hint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hint)

        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .bold)), for: .normal)
        close.tintColor = .white
        close.backgroundColor = UIColor.white.withAlphaComponent(0.2)
        close.layer.cornerRadius = 22
        close.accessibilityLabel = "Close"
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        view.addSubview(close)

        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.68),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            hint.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            hint.topAnchor.constraint(equalTo: frame.bottomAnchor, constant: 24),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        sessionQueue.async { self.session.startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { self.session.stopRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let value = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        finish(value)
    }

    @objc private func cancel() { finish(nil) }

    private func finish(_ value: String?) {
        guard !finished else { return }
        finished = true
        if value != nil { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        dismiss(animated: true) { self.onResult?(value) }
    }
}
