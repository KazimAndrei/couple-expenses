import UIKit
import UniformTypeIdentifiers
import PDFKit

// «Поделиться → CoupleExpenses»: слип, чек или счёт (картинка/PDF) кладётся во входящие
// общей App Group, после чего открывается приложение — там распознаём и предлагаем добавить расход.
final class ShareViewController: UIViewController {
    private let appGroup = "group.com.kazimandrei.coupleexpenses"
    private let spinner = UIActivityIndicatorView(style: .large)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.color = .white
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        spinner.startAnimating()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await handle() }
    }

    private func handle() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        var saved = 0
        for provider in providers.prefix(10) {
            if let image = await loadImage(provider), save(image) { saved += 1 }
        }
        await MainActor.run {
            if saved > 0 { openHostApp() }
            extensionContext?.completeRequest(returningItems: nil)
        }
    }

    private func loadImage(_ provider: NSItemProvider) async -> UIImage? {
        if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.pdf.identifier) else { return nil }
            let data = (item as? URL).flatMap { try? Data(contentsOf: $0) } ?? item as? Data
            return data.flatMap(renderPdf)
        }
        guard provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
              let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) else { return nil }
        if let image = item as? UIImage { return image }
        if let url = item as? URL, let data = try? Data(contentsOf: url) { return UIImage(data: data) }
        if let data = item as? Data { return UIImage(data: data) }
        return nil
    }

    // Первая страница PDF-квитанции → картинка
    private func renderPdf(_ data: Data) -> UIImage? {
        guard let page = PDFDocument(data: data)?.page(at: 0) else { return nil }
        let box = page.bounds(for: .mediaBox)
        let scale = min(3, 2000 / max(box.width, box.height, 1))
        return page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
    }

    private func save(_ image: UIImage) -> Bool {
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
                .appendingPathComponent("Inbox", isDirectory: true),
              let data = downscaled(image).jpegData(compressionQuality: 0.85) else { return false }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Время — в имени файла (приложение не читает файловые даты); запись атомарная,
        // чтобы приложение никогда не увидело недописанный файл
        let name = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).jpg"
        return (try? data.write(to: dir.appendingPathComponent(name), options: .atomic)) != nil
    }

    private func downscaled(_ image: UIImage) -> UIImage {
        let side = max(image.size.width, image.size.height)
        guard side > 2200 else { return image }
        let k = 2200 / side
        let size = CGSize(width: image.size.width * k, height: image.size.height * k)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    // Расширению недоступен UIApplication.open — находим приложение по цепочке responder'ов
    // и вызываем openURL:options:completionHandler: через рантайм
    private func openHostApp() {
        guard let url = URL(string: "coupleexpenses://import") else { return }
        let selector = sel_registerName("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        while let r = responder {
            if r is UIApplication, r.responds(to: selector), let imp = r.method(for: selector) {
                // Только Objective-C типы: Swift-словарь здесь роняет расширение
                typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
                unsafeBitCast(imp, to: OpenURL.self)(r, selector, url as NSURL, NSDictionary(), nil)
                return
            }
            responder = r.next
        }
    }
}
