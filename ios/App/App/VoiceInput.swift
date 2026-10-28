import UIKit
import Speech
import AVFoundation
import Capacitor

// Голосовой ввод расхода: «кофе 120», «вчера продукты 1800». Распознаёт Apple Speech
// (на устройстве, если язык это умеет); фраза разбирается в JS (src/lib/voice.js).
extension SlipScannerPlugin {
    @objc func listen(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? Locale.preferredLanguages.first ?? "en-US"
        SFSpeechRecognizer.requestAuthorization { speech in
            guard speech == .authorized else { call.resolve(["denied": true]); return }
            AVAudioSession.sharedInstance().requestRecordPermission { mic in
                DispatchQueue.main.async {
                    guard mic else { call.resolve(["denied": true]); return }
                    let vc = VoiceInputViewController(locale: Locale(identifier: locale))
                    vc.onResult = { text in
                        call.resolve(text.map { ["text": $0] } ?? ["cancelled": true])
                    }
                    vc.modalPresentationStyle = .overFullScreen
                    vc.modalTransitionStyle = .crossDissolve
                    guard let host = self.topViewController() else { call.resolve(["cancelled": true]); return }
                    host.present(vc, animated: true)
                }
            }
        }
    }
}

final class VoiceInputViewController: UIViewController {
    var onResult: ((String?) -> Void)?
    private let recognizer: SFSpeechRecognizer?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var transcript = ""
    private var silenceTimer: Timer?
    private var finished = false
    private var onDeviceFailed = false
    private var generation = 0
    // Звуки приложения после диктовки должны играть как раньше — возвращаем прежнюю категорию
    private let previousCategory = AVAudioSession.sharedInstance().category
    private let previousMode = AVAudioSession.sharedInstance().mode
    private let previousOptions = AVAudioSession.sharedInstance().categoryOptions
    private let ru: Bool

    private let card = UIView()
    private let textLabel = UILabel()
    private let hintLabel = UILabel()
    private let pulse = UIView()
    private let doneButton = UIButton(type: .system)

    init(locale: Locale) {
        recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
        ru = locale.identifier.hasPrefix("ru")
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        view.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(backgroundTap(_:))))

        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 28
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let mint = UIColor(red: 0.11, green: 0.62, blue: 0.46, alpha: 1)
        pulse.backgroundColor = mint
        pulse.layer.cornerRadius = 36
        pulse.translatesAutoresizingMaskIntoConstraints = false
        let mic = UIImageView(image: UIImage(systemName: "mic.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 28, weight: .semibold)))
        mic.tintColor = .white
        mic.translatesAutoresizingMaskIntoConstraints = false
        pulse.addSubview(mic)

        hintLabel.text = ru ? "Скажите расход, например:\n«кофе 120» или «вчера продукты 1800»" : "Say an expense, for example:\n“coffee 120” or “groceries 1800 yesterday”"
        hintLabel.numberOfLines = 0
        hintLabel.textAlignment = .center
        hintLabel.font = .systemFont(ofSize: 15)
        hintLabel.textColor = .secondaryLabel

        textLabel.text = ru ? "Слушаю…" : "Listening…"
        textLabel.numberOfLines = 0
        textLabel.textAlignment = .center
        textLabel.font = .systemFont(ofSize: 24, weight: .semibold)

        doneButton.setTitle(ru ? "Готово" : "Done", for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.backgroundColor = mint
        doneButton.tintColor = .white
        doneButton.layer.cornerRadius = 14
        doneButton.addTarget(self, action: #selector(done), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [pulse, textLabel, hintLabel, doneButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            pulse.widthAnchor.constraint(equalToConstant: 72),
            pulse.heightAnchor.constraint(equalToConstant: 72),
            mic.centerXAnchor.constraint(equalTo: pulse.centerXAnchor),
            mic.centerYAnchor.constraint(equalTo: pulse.centerYAnchor),
            doneButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            doneButton.heightAnchor.constraint(equalToConstant: 50),
            textLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIView.animate(withDuration: 0.8, delay: 0, options: [.autoreverse, .repeat, .allowUserInteraction]) {
            self.pulse.transform = CGAffineTransform(scaleX: 1.12, y: 1.12)
        }
        start()
    }

    private func start() {
        guard let recognizer, recognizer.isAvailable else { fail(); return }
        // Колбэки отменённой попытки (после перехода на сервер) игнорируем
        generation += 1
        let gen = generation
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            // На устройстве — приватнее и без сети; если модель не скачана, повторяем через сервер Apple
            if recognizer.supportsOnDeviceRecognition && !onDeviceFailed { request.requiresOnDeviceRecognition = true }
            request.contextualStrings = ["THB", "бат", "baht", "Grab", "7-Eleven", "Tops"]
            self.request = request
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, gen == self.generation else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        self.textLabel.text = self.transcript
                        self.restartSilenceTimer()
                        if result.isFinal { self.done() }
                    } else if error != nil, self.transcript.isEmpty, !self.finished {
                        if request.requiresOnDeviceRecognition && !self.onDeviceFailed {
                            self.onDeviceFailed = true
                            self.stop()
                            self.start()
                        } else {
                            self.fail()
                        }
                    }
                }
            }
        } catch {
            fail()
        }
    }

    // Замолчал на 1.8 с после первых слов — считаем фразу законченной
    private func restartSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.8, repeats: false) { [weak self] _ in self?.done() }
    }

    private func fail() {
        pulse.layer.removeAllAnimations()
        pulse.transform = .identity
        textLabel.text = ru ? "Не получилось распознать речь" : "Couldn’t recognize speech"
        doneButton.setTitle(ru ? "Закрыть" : "Close", for: .normal)
    }

    private func stop() {
        silenceTimer?.invalidate()
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(previousCategory, mode: previousMode, options: previousOptions)
    }

    @objc private func done() { finish(transcript.trimmingCharacters(in: .whitespacesAndNewlines)) }

    @objc private func backgroundTap(_ g: UITapGestureRecognizer) {
        if !card.frame.contains(g.location(in: view)) { finish("") }
    }

    private func finish(_ text: String) {
        guard !finished else { return }
        finished = true
        stop()
        dismiss(animated: true) { self.onResult?(text.isEmpty ? nil : text) }
    }
}
