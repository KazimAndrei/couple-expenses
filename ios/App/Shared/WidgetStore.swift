import Foundation
import Security

// Общий keychain команды разработчика: его видят приложение и расширения (виджеты,
// «Поделиться») без App Group — keychain-access-groups с префиксом команды входит в любой
// профиль подписи. Файл подключён во все три таргета.
enum SharedKeychain {
    static let accessGroup = "5Z877T87NX.com.kazimandrei.coupleexpenses.shared"

    private static func query(_ service: String, _ account: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccessGroup as String: accessGroup]
        if let account { q[kSecAttrAccount as String] = account }
        return q
    }

    @discardableResult
    static func set(_ data: Data?, service: String, account: String) -> Bool {
        SecItemDelete(query(service, account) as CFDictionary)
        guard let data, !data.isEmpty else { return true }
        var add = query(service, account)
        add[kSecValueData as String] = data
        // Виджет обновляется и при заблокированном телефоне — доступ после первой разблокировки
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(service: String, account: String) -> Data? {
        var q = query(service, account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    // Имена всех записей сервиса (без данных — чтобы не тянуть картинки разом)
    static func accounts(service: String) -> [String] {
        var q = query(service, nil)
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let list = out as? [[String: Any]] else { return [] }
        return list.compactMap { $0[kSecAttrAccount as String] as? String }.sorted()
    }

    static func delete(service: String, account: String) {
        SecItemDelete(query(service, account) as CFDictionary)
    }
}

// Снимок данных для виджетов
enum WidgetStore {
    private static let service = "com.kazimandrei.coupleexpenses.widget"
    static func write(_ json: String) { SharedKeychain.set(json.data(using: .utf8), service: service, account: "snapshot") }
    static func read() -> Data? { SharedKeychain.get(service: service, account: "snapshot") }
}

// Входящие из «Поделиться»: картинка JPEG, имя «<ms>-<uuid>.jpg»
enum ShareInbox {
    static let service = "com.kazimandrei.coupleexpenses.inbox"
    static func add(_ jpeg: Data) -> Bool {
        let id = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).jpg"
        return SharedKeychain.set(jpeg, service: service, account: id)
    }
    static func ids() -> [String] { SharedKeychain.accounts(service: service) }
    static func data(_ id: String) -> Data? { SharedKeychain.get(service: service, account: id) }
    static func remove(_ id: String) { SharedKeychain.delete(service: service, account: id) }
}
