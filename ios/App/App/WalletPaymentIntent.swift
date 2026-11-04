import AppIntents
import Foundation
import UserNotifications

// Оплата Apple Pay: прочитать транзакции Кошелька приложение не может (FinanceKit — только Apple Card
// и несколько банков США/Великобритании), зато автоматизация «Команд» с триггером «Транзакция» передаёт
// сумму и продавца в это действие. Кладём во входящие (общий keychain, Shared/WidgetStore.swift),
// приложение покажет оплату в листе «Нашли оплаты». Разбор суммы — в src/lib/wallet-payments.js.
enum WalletInbox {
    private static let service = "com.kazimandrei.coupleexpenses.payments"

    static func add(amount: String, merchant: String?, card: String?) -> Bool {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let item: [String: Any] = ["amount": amount, "merchant": merchant ?? "", "card": card ?? "", "created": now]
        guard let data = try? JSONSerialization.data(withJSONObject: item) else { return false }
        return SharedKeychain.set(data, service: service, account: "\(now)-\(UUID().uuidString)")
    }

    static func all() -> [[String: Any]] {
        SharedKeychain.accounts(service: service).compactMap { id in
            guard let data = SharedKeychain.get(service: service, account: id),
                  var item = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                remove(id) // битая запись — не показываем её вечно
                return nil
            }
            item["id"] = id
            return item
        }
    }

    static func remove(_ id: String) { SharedKeychain.delete(service: service, account: id) }
}

@available(iOS 16.0, *)
struct LogWalletPaymentIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Apple Pay payment"
    static var description = IntentDescription("Saves a Wallet payment to CoupleExpenses. Use it in a Transaction automation.")
    // Срабатывает сразу после оплаты, в том числе на заблокированном телефоне — приложение не открываем
    static var openAppWhenRun = false

    // Строкой: «Команды» отдают сумму вместе с валютой («฿110.00», «THB 110.00»)
    @Parameter(title: "Amount")
    var amount: String

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Card")
    var card: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$amount) at \(\.$merchant)") {
            \.$card
        }
    }

    func perform() async throws -> some IntentResult {
        guard WalletInbox.add(amount: amount, merchant: merchant, card: card) else {
            throw $amount.needsValueError()
        }
        await notify()
        return .result()
    }

    // Напоминание с суммой: нажали — приложение открылось на этой оплате. Нет разрешения — оплата просто ждёт во входящих
    private func notify() async {
        let center = UNUserNotificationCenter.current()
        guard await center.notificationSettings().authorizationStatus == .authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = [amount, merchant].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        content.body = String(localized: "Tap to add it to your expenses")
        try? await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
}
