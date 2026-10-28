import WidgetKit
import SwiftUI

// Виджеты CoupleExpenses. Данные — снимок, который приложение кладёт в общий keychain
// (Shared/WidgetStore.swift) после каждой загрузки; подписи приходят в нём же, на языке приложения.

struct Snapshot: Decodable {
    struct Part: Decodable { let name: String?; let amount: String; let share: Double }
    struct Split: Decodable { let a: Part; let b: Part?; let shared: Part }
    struct Category: Decodable { let name: String; let amount: String; let share: Double; let color: String }
    struct Goal: Decodable { let name: String; let saved: String; let target: String; let share: Double }
    struct Last: Decodable { let title: String; let amount: String }

    let updatedAt: Double
    let lang: String?
    let day: String?
    let monthKey: String?
    let zero: String?
    let month: String
    let total: String
    let today: String
    let perDay: String
    let forecast: String
    let income: String?
    let left: String?
    let usedShare: Double?
    let over: Bool
    let solo: Bool
    let split: Split?
    let topCategories: [Category]
    let goal: Goal?
    let last: Last?
    let count: Int
    let hero: Hero?
    let flow: Flow?
    let l: [String: String]

    struct Flow: Decodable {
        let incomeLabel: String; let income: String
        let leftLabel: String; let left: String; let negative: Bool
        let spentPct: Int; let savedPct: Int
        let spentText: String; let savedText: String?
    }

    struct Hero: Decodable { let label: String; let meta: String; let income: String? }

    func t(_ key: String) -> String { l[key] ?? key }
    var isRu: Bool { (lang ?? (ru ? "ru" : "en")) == "ru" }

    // Снимок сделан в другой день / месяц: приложение давно не открывали
    func isStaleMonth(at date: Date) -> Bool { monthKey != nil && monthKey != Snapshot.key(date, "yyyy-MM") }
    func isStaleDay(at date: Date) -> Bool { day != nil && day != Snapshot.key(date, "yyyy-MM-dd") }
    func todayText(at date: Date) -> String { isStaleDay(at: date) ? (zero ?? "0") : today }

    static func key(_ date: Date, _ format: String) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f.string(from: date)
    }

    static func load() -> Snapshot? {
        guard let data = WidgetStore.read() else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let raw: Snapshot?
    // Снимок прошлого месяца не показываем как текущий
    var snap: Snapshot? { raw.flatMap { $0.isStaleMonth(at: date) ? nil : $0 } }
    var staleMonth: Bool { raw?.isStaleMonth(at: date) == true }

    init(date: Date, snap: Snapshot?) { self.date = date; self.raw = snap }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: Date(), snap: Preview.snap) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), snap: Snapshot.load() ?? Preview.snap))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // Приложение само перезагружает виджеты после изменений; отдельная запись на полночь —
        // чтобы «сегодня» обнулилось и смена месяца была видна, даже если приложение не открывали
        let snap = Snapshot.load()
        let now = Date()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
        let next = min(Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now.addingTimeInterval(3600), midnight)
        var entries = [Entry(date: now, snap: snap)]
        if midnight.timeIntervalSince(now) < 3600 { entries.append(Entry(date: midnight, snap: snap)) }
        completion(Timeline(entries: entries, policy: .after(next.addingTimeInterval(1))))
    }
}

// MARK: - Оформление

enum Palette {
    static let mint = Color(red: 0.56, green: 0.96, blue: 0.81)
    static let green = Color(red: 0.11, green: 0.62, blue: 0.46)
    static let coral = Color(red: 0.91, green: 0.45, blue: 0.35)
    static let violet = Color(red: 0.50, green: 0.47, blue: 0.87)
    static let bg = LinearGradient(colors: [Color(red: 0.06, green: 0.24, blue: 0.20), Color(red: 0.09, green: 0.36, blue: 0.29), Color(red: 0.11, green: 0.62, blue: 0.46)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let v = UInt64(h, radix: 16) ?? 0x888780
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

extension View {
    // iOS 17 требует фон контейнера; на старых системах рисуем его сами
    @ViewBuilder func widgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { Palette.bg }
        } else {
            // До iOS 17 система не добавляет поля — ставим стандартные 16pt сами
            frame(maxWidth: .infinity, maxHeight: .infinity).padding(16).background(Palette.bg)
        }
    }
}

let ru = Locale.preferredLanguages.first?.hasPrefix("ru") == true

struct EmptyStateView: View {
    var stale: Snapshot? = nil
    var color: Color = .white
    var body: some View {
        let isRu = stale?.isRu ?? ru
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: stale == nil ? "heart.fill" : "arrow.clockwise").foregroundColor(Palette.mint)
            Text(stale.map { "\($0.t("spent")) · \($0.month)" } ?? (isRu ? "Откройте CoupleExpenses" : "Open CoupleExpenses"))
                .font(.system(size: 14, weight: .semibold)).foregroundColor(color).lineLimit(2)
            Text(stale?.t("stale") ?? (isRu ? "и виджет покажет ваши траты" : "to see your spending here"))
                .font(.system(size: 12)).foregroundColor(color.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct Bar: View {
    let share: Double
    var color: Color = Palette.mint
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18))
                Capsule().fill(color).frame(width: max(4, g.size.width * min(1, max(0, share))))
            }
        }
        .frame(height: 6)
    }
}

struct Label2: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.4).foregroundColor(.white.opacity(0.65)).lineLimit(1)
    }
}

struct Amount: View {
    let text: String
    var size: CGFloat = 26
    var body: some View {
        Text(text).font(.system(size: size, weight: .bold, design: .rounded)).foregroundColor(.white)
            .minimumScaleFactor(0.5).lineLimit(1)
    }
}

// MARK: - 1. Месяц: сколько потрачено и сколько осталось

struct MonthView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                VStack(alignment: .leading, spacing: 6) {
                    Label2(text: family == .systemSmall ? s.month : "\(s.t("spent")) · \(s.month)")
                    Amount(text: s.total, size: family == .systemSmall ? 26 : 32)
                    Spacer(minLength: 0)
                    if let left = s.left, let used = s.usedShare {
                        Bar(share: used, color: s.over ? Palette.coral : Palette.mint)
                        Text(s.over ? "\(s.t("over")) \(left.replacingOccurrences(of: "-", with: ""))" : "\(s.t("left")) \(left)")
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(s.over ? Palette.coral : .white).lineLimit(1).minimumScaleFactor(0.7)
                    } else {
                        Text("≈ \(s.perDay) \(s.t("perDay"))").font(.system(size: 12, weight: .medium)).foregroundColor(.white.opacity(0.8)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    if family != .systemSmall {
                        HStack {
                            Text("\(s.t("today")): \(s.todayText(at: entry.date))")
                            Spacer()
                            Text("\(s.t("forecast")): \(s.forecast)")
                        }
                        .font(.system(size: 11)).foregroundColor(.white.opacity(0.7)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
            } else { EmptyStateView(stale: entry.staleMonth ? entry.raw : nil) }
        }
        .padding(family == .systemSmall ? 2 : 4)
        .widgetBackground()
        .widgetURL(URL(string: "coupleexpenses://home"))
    }
}

struct MonthWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEMonth", provider: Provider()) { MonthView(entry: $0) }
            .configurationDisplayName(ru ? "Расходы за месяц" : "Monthly spending")
            .description(ru ? "Сколько потрачено и сколько осталось до конца месяца." : "How much you’ve spent and what’s left this month.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - 2. Сегодня + быстрые кнопки

struct QuickButton: View {
    let icon: String
    let title: String
    let url: String
    var body: some View {
        Link(destination: URL(string: url)!) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold))
                Text(title).font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.white.opacity(0.16)))
        }
    }
}

struct TodayView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                if family == .systemSmall {
                    VStack(alignment: .leading, spacing: 4) {
                        Label2(text: s.t("today"))
                        Amount(text: s.todayText(at: entry.date), size: 28)
                        if let last = s.last {
                            Text("\(s.t("last")): \(last.title)").font(.system(size: 11)).foregroundColor(.white.opacity(0.7)).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        HStack(spacing: 6) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 18))
                            Text(s.t("add")).font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundColor(Palette.mint)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(URL(string: "coupleexpenses://add"))
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Label2(text: s.t("today"))
                                Amount(text: s.todayText(at: entry.date), size: 26)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Label2(text: s.month)
                                Text(s.total).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundColor(.white.opacity(0.85)).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        HStack(spacing: 8) {
                            QuickButton(icon: "plus", title: s.t("add"), url: "coupleexpenses://add")
                            QuickButton(icon: "mic.fill", title: s.t("voice"), url: "coupleexpenses://add?mode=voice")
                            QuickButton(icon: "qrcode.viewfinder", title: s.t("qr"), url: "coupleexpenses://add?mode=qr")
                        }
                    }
                }
            } else { EmptyStateView(stale: entry.staleMonth ? entry.raw : nil) }
        }
        .padding(4)
        .widgetBackground()
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEToday", provider: Provider()) { TodayView(entry: $0) }
            .configurationDisplayName(ru ? "Сегодня и быстрый ввод" : "Today & quick add")
            .description(ru ? "Траты за сегодня и кнопки: расход, голос, QR." : "Today’s spending with Add, Voice and QR buttons.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - 3. Кто сколько и на что

struct BreakdownView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Label2(text: "\(s.t("spent")) · \(s.month)")
                        Spacer()
                        Text(s.total).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.6)
                    }
                    if let sp = s.split {
                        HeroCardView.bar(sp, height: 7)
                        HStack(spacing: 10) {
                            dot(Hero.mint, sp.a.name ?? "", sp.a.amount)
                            if sp.shared.share > 0 { dot(Hero.coral.opacity(0.8), s.t("shared"), sp.shared.amount) }
                            if let b = sp.b { dot(Hero.coral, b.name ?? "", b.amount) }
                        }
                    }
                    if s.topCategories.isEmpty {
                        Spacer()
                        Text(s.t("empty")).font(.system(size: 13)).foregroundColor(.white.opacity(0.7))
                        Spacer()
                    } else {
                        Label2(text: s.t("top")).padding(.top, 2)
                        ForEach(Array(s.topCategories.prefix(family == .systemLarge ? 6 : (s.split == nil ? 3 : 2)).enumerated()), id: \.offset) { _, c in
                            VStack(spacing: family == .systemLarge ? 6 : 3) {
                                HStack {
                                    Circle().fill(Color(hex: c.color)).frame(width: 8, height: 8)
                                    Text(c.name).font(.system(size: 12, weight: .medium)).foregroundColor(.white).lineLimit(1)
                                    Spacer()
                                    Text(c.amount).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundColor(.white).lineLimit(1)
                                }
                                Bar(share: c.share, color: Color(hex: c.color))
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
            } else { EmptyStateView(stale: entry.staleMonth ? entry.raw : nil) }
        }
        .padding(4)
        .widgetBackground()
        .widgetURL(URL(string: "coupleexpenses://home"))
    }

    func dot(_ color: Color, _ name: String, _ amount: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text("\(name) \(amount)").font(.system(size: 11, weight: .medium)).foregroundColor(.white.opacity(0.85)).lineLimit(1).minimumScaleFactor(0.6)
        }
    }
}

struct BreakdownWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEBreakdown", provider: Provider()) { BreakdownView(entry: $0) }
            .configurationDisplayName(ru ? "Кто сколько и на что" : "Who spent what")
            .description(ru ? "Доли партнёров и самые большие категории месяца." : "Each partner’s share and the top categories this month.")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - 4. Цель накопления

struct GoalView: View {
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                if let g = s.goal {
                    VStack(alignment: .leading, spacing: 6) {
                        Label2(text: s.t("goal"))
                        Text(g.name).font(.system(size: 15, weight: .semibold)).foregroundColor(.white).lineLimit(2)
                        Spacer(minLength: 0)
                        ZStack {
                            Circle().stroke(Color.white.opacity(0.18), lineWidth: 7)
                            Circle().trim(from: 0, to: g.share).stroke(Palette.mint, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90))
                            Text("\(Int((g.share * 100).rounded()))%").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(.white)
                        }
                        .frame(width: 56, height: 56)
                        Text("\(g.saved) \(s.t("of")) \(g.target)").font(.system(size: 11)).foregroundColor(.white.opacity(0.75)).lineLimit(1).minimumScaleFactor(0.6)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Image(systemName: "target").font(.system(size: 22)).foregroundColor(Palette.mint)
                        Text(s.t("noGoal")).font(.system(size: 13, weight: .medium)).foregroundColor(.white)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                }
            } else { EmptyStateView(stale: entry.staleMonth ? entry.raw : nil) }
        }
        .padding(2)
        .widgetBackground()
        .widgetURL(URL(string: "coupleexpenses://goals"))
    }
}

struct GoalWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEGoal", provider: Provider()) { GoalView(entry: $0) }
            .configurationDisplayName(ru ? "Цель накопления" : "Savings goal")
            .description(ru ? "Как близко ваша главная цель." : "How close your top savings goal is.")
            .supportedFamilies([.systemSmall])
    }
}

// MARK: - 5. Экран блокировки
// Расширение виджетов требует iOS 16 (if #available внутри WidgetBundle падает); на iOS 15 виджетов просто нет

struct LockView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snap {
                switch family {
                case .accessoryCircular:
                    if let used = s.usedShare {
                        Gauge(value: used) { Image(systemName: "creditcard") } currentValueLabel: { Text("\(Int((used * 100).rounded()))%") }
                            .gaugeStyle(.accessoryCircularCapacity)
                    } else {
                        ZStack {
                            AccessoryWidgetBackground()
                            VStack(spacing: 0) {
                                Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                                Text(s.t("add")).font(.system(size: 9, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.6)
                            }
                        }
                        .widgetURL(URL(string: "coupleexpenses://add"))
                    }
                case .accessoryInline:
                    Text("\(s.t("today")) \(s.todayText(at: entry.date)) · \(s.total)")
                default:
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.month).font(.system(size: 11, weight: .semibold)).widgetAccentable().lineLimit(1)
                        Text(s.total).font(.system(size: 17, weight: .bold, design: .rounded)).minimumScaleFactor(0.6).privacySensitive()
                        if let left = s.left {
                            Text(s.over ? "\(s.t("over")) \(left.replacingOccurrences(of: "-", with: ""))" : "\(s.t("left")) \(left)").font(.system(size: 11)).lineLimit(1)
                        } else {
                            Text("\(s.t("today")) \(s.todayText(at: entry.date))").font(.system(size: 11)).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Image(systemName: "heart.fill")
            }
        }
        // Суммы на экране блокировки скрываются, если в настройках iOS выключены данные на заблокированном экране
        .privacySensitive()
        .widgetBackgroundAccessory()
    }
}

extension View {
    @ViewBuilder func widgetBackgroundAccessory() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}

struct LockWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CELock", provider: Provider()) { LockView(entry: $0) }
            .configurationDisplayName(ru ? "Бюджет на экране блокировки" : "Budget on Lock Screen")
            .description(ru ? "Потрачено, остаток и процент бюджета." : "Spent, what’s left and budget used.")
            .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - 6. Карточка главного экрана целиком

enum Hero {
    static let mint = Color(red: 0.50, green: 0.94, blue: 0.79)   // #7ff0c9
    static let coral = Color(red: 1.0, green: 0.70, blue: 0.62)   // #ffb39f
    static let from = Color(red: 0.06, green: 0.43, blue: 0.34)   // #0f6e56
    static let to = Color(red: 0.11, green: 0.62, blue: 0.46)     // #1d9e75

    // Фон как у .hero: диагональный градиент, блик сверху справа и два круга
    static var background: some View {
        ZStack {
            LinearGradient(colors: [from, to], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color.white.opacity(0.18), .clear], center: .topTrailing, startRadius: 0, endRadius: 220)
            GeometryReader { g in
                Circle().fill(Color.white.opacity(0.08)).frame(width: 180, height: 180)
                    .position(x: g.size.width + 30, y: 20)
                Circle().stroke(Color.white.opacity(0.14), lineWidth: 1).frame(width: 120, height: 120)
                    .position(x: g.size.width - 100, y: -20)
            }
        }
    }

    // «Осталось <b>71 333 ฿</b> из 180 904 ฿» → обычный текст + жирная сумма
    static func rich(_ html: String, size: CGFloat) -> Text {
        var out = Text("")
        var rest = Substring(html)
        while let open = rest.range(of: "<b>") {
            out = out + Text(String(rest[..<open.lowerBound]))
            rest = rest[open.upperBound...]
            guard let close = rest.range(of: "</b>") else { break }
            out = out + Text(String(rest[..<close.lowerBound])).fontWeight(.bold)
            rest = rest[close.upperBound...]
        }
        return (out + Text(String(rest))).font(.system(size: size))
    }
}

struct HeroCardView: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var large: Bool { family == .systemLarge }

    var body: some View {
        Group {
            if let s = entry.snap {
                VStack(alignment: .leading, spacing: 0) {
                    Text(s.hero?.label ?? s.t("spent")).font(.system(size: large ? 15 : 12, weight: .semibold)).opacity(0.86)
                    Text(s.total).font(.system(size: large ? 46 : 28, weight: .bold)).tracking(-1)
                        .minimumScaleFactor(0.6).lineLimit(1).padding(.top, large ? 2 : 0)
                    Text(s.hero?.meta ?? "").font(.system(size: large ? 14 : 11)).opacity(0.8).lineLimit(1).minimumScaleFactor(0.7)
                    if let sp = s.split {
                        splitBar(sp).padding(.top, large ? 16 : 7)
                        legend(sp).padding(.top, large ? 10 : 6)
                    }
                    if large && !s.topCategories.isEmpty {
                        Spacer(minLength: 10)
                        VStack(spacing: 9) {
                            ForEach(Array(s.topCategories.prefix(s.split == nil ? 5 : 4).enumerated()), id: \.offset) { _, c in
                                HStack(spacing: 8) {
                                    Circle().fill(Color(hex: c.color)).frame(width: 9, height: 9)
                                    Text(c.name).font(.system(size: 14)).lineLimit(1)
                                    Spacer()
                                    Text(c.amount).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                                }
                                .opacity(0.92)
                            }
                        }
                    }
                    Spacer(minLength: large ? 10 : 0)
                    if let income = s.hero?.income { incomeBox(income, s) }
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else { EmptyStateView(stale: entry.staleMonth ? entry.raw : nil) }
        }
        .heroBackground()
        .widgetURL(URL(string: "coupleexpenses://home"))
    }

    func splitBar(_ sp: Snapshot.Split) -> some View { Self.bar(sp, height: large ? 9 : 7) }

    // Полоса долей: сегменты с нулевой долей не рисуем, промежутки вычитаем — ничего не вылезает за край
    static func bar(_ sp: Snapshot.Split, height: CGFloat) -> some View {
        GeometryReader { g in
            let parts: [(Double, AnyShapeStyle)] = [
                (sp.a.share, AnyShapeStyle(Hero.mint)),
                (sp.shared.share, AnyShapeStyle(LinearGradient(colors: [Hero.mint, Hero.coral], startPoint: .leading, endPoint: .trailing))),
                (sp.b?.share ?? 0, AnyShapeStyle(Hero.coral)),
            ].filter { $0.0 > 0 }
            let w = max(0, g.size.width - CGFloat(max(0, parts.count - 1)) * 2)
            HStack(spacing: 2) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, p in
                    Capsule().fill(p.1).frame(width: max(4, w * CGFloat(p.0)))
                }
            }
            .frame(width: g.size.width, alignment: .leading)
            .clipShape(Capsule())
            .background(Capsule().fill(Color.white.opacity(0.18)))
        }
        .frame(height: height)
    }

    func legend(_ sp: Snapshot.Split) -> some View {
        let size: CGFloat = large ? 14 : 11
        let a = item(AnyView(Circle().fill(Hero.mint)), sp.a.name ?? "", sp.a.amount, size)
        let shared = item(AnyView(Circle().fill(LinearGradient(colors: [Hero.mint, Hero.coral], startPoint: .leading, endPoint: .trailing))), entry.snap?.t("shared") ?? "", sp.shared.amount, size)
        let b = sp.b.map { item(AnyView(Circle().fill(Hero.coral)), $0.name ?? "", $0.amount, size) }
        let showShared = sp.shared.share > 0
        // Большой — как в приложении (партнёр на второй строке), средний — всё в одну строку
        return Group {
            if large {
                VStack(alignment: .leading, spacing: 8) {
                    HStack { a; Spacer(minLength: 6); if showShared { shared } }
                    if let b { b }
                }
            } else {
                HStack(spacing: 8) { a; Spacer(minLength: 2); if showShared { shared }; Spacer(minLength: 2); if let b { b } }
            }
        }
    }

    func item(_ dot: AnyView, _ name: String, _ amount: String, _ size: CGFloat) -> some View {
        HStack(spacing: 5) {
            dot.frame(width: size * 0.62, height: size * 0.62)
            (Text(name + " ").font(.system(size: size)) + Text(amount).font(.system(size: size, weight: .semibold)))
                .opacity(0.92).lineLimit(1).minimumScaleFactor(0.6)
        }
    }

    func incomeBox(_ html: String, _ s: Snapshot) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: large ? 8 : 5) {
                Hero.rich(html, size: large ? 15 : 11.5).lineLimit(1).minimumScaleFactor(0.85)
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.white.opacity(0.22))
                        Capsule().fill(s.over ? Hero.coral : Color.white).frame(width: max(4, g.size.width * (s.usedShare ?? 0)))
                    }
                }
                .frame(height: 4)
            }
            if large {
                ZStack {
                    Circle().fill(Color.white.opacity(0.2))
                    Image(systemName: "wallet.pass").font(.system(size: 18, weight: .medium))
                }
                .frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, large ? 14 : 10)
        .padding(.vertical, large ? 14 : 7)
        .background(RoundedRectangle(cornerRadius: large ? 16 : 12).fill(Color.white.opacity(0.13)))
    }
}

extension View {
    @ViewBuilder func heroBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { Hero.background }
        } else {
            frame(maxWidth: .infinity, maxHeight: .infinity).padding(16).background(Hero.background)
        }
    }
}

struct HeroCardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEHero", provider: Provider()) { HeroCardView(entry: $0) }
            .configurationDisplayName(ru ? "Потратили вместе" : "Spent together")
            .description(ru ? "Карточка с главного экрана: сумма, доли и остаток." : "The home card: total, each share and what’s left.")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}

// MARK: - 7. «Доход за месяц» — карточка из аналитики, светлая или тёмная по теме телефона

struct FlowColors {
    let scheme: ColorScheme
    var surface: Color { scheme == .dark ? Color(red: 0.118, green: 0.118, blue: 0.110) : .white }                       // --c-surface
    var track: Color { scheme == .dark ? Color(red: 0.149, green: 0.149, blue: 0.141) : Color(red: 0.94, green: 0.933, blue: 0.918) } // --c-surface-alt
    var text: Color { scheme == .dark ? Color(red: 0.91, green: 0.90, blue: 0.87) : Color(red: 0.10, green: 0.10, blue: 0.094) }
    var secondary: Color { scheme == .dark ? Color(red: 0.60, green: 0.596, blue: 0.565) : Color(red: 0.478, green: 0.47, blue: 0.44) }
    var accent: Color { scheme == .dark ? Color(red: 0.30, green: 0.63, blue: 0.49) : Color(red: 0.114, green: 0.62, blue: 0.459) }
    let danger = Color(red: 0.886, green: 0.294, blue: 0.29)
    let saved = Color(red: 0.498, green: 0.467, blue: 0.867)
}

struct FlowView: View {
    @Environment(\.colorScheme) var scheme
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        let c = FlowColors(scheme: scheme)
        Group {
            if let s = entry.snap, let f = s.flow {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(f.incomeLabel).font(.system(size: 13)).foregroundColor(c.secondary).lineLimit(1)
                            Text(f.income).font(.system(size: 24, weight: .bold)).foregroundColor(c.text).minimumScaleFactor(0.5).lineLimit(1)
                        }
                        Spacer(minLength: 10)
                        VStack(alignment: .trailing, spacing: 6) {
                            Text(f.leftLabel).font(.system(size: 13)).foregroundColor(c.secondary).lineLimit(1)
                            Text(f.left).font(.system(size: 24, weight: .bold)).foregroundColor(f.negative ? c.danger : c.accent).minimumScaleFactor(0.5).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    GeometryReader { g in
                        HStack(spacing: 0) {
                            Rectangle().fill(c.accent).frame(width: g.size.width * CGFloat(f.spentPct) / 100)
                            Rectangle().fill(c.saved).frame(width: g.size.width * CGFloat(f.savedPct) / 100)
                            Spacer(minLength: 0)
                        }
                        .background(c.track)
                        .clipShape(Capsule())
                    }
                    .frame(height: 10)
                    Spacer(minLength: 8)
                    HStack(spacing: 14) {
                        legend(c.accent, f.spentText, c)
                        if let saved = f.savedText { legend(c.saved, saved, c) }
                    }
                }
            } else if entry.snap != nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text(entry.snap?.t("incomeTitle") ?? "").font(.system(size: 13)).foregroundColor(c.secondary)
                    Text(entry.snap?.t("noIncome") ?? "")
                        .font(.system(size: 14, weight: .medium)).foregroundColor(c.text)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            } else {
                EmptyStateView(stale: entry.staleMonth ? entry.raw : nil, color: c.text)
            }
        }
        .padding(2)
        .flowBackground(c.surface)
        .widgetURL(URL(string: "coupleexpenses://analytics"))
    }

    func legend(_ color: Color, _ text: String, _ c: FlowColors) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.system(size: 12)).foregroundColor(c.secondary).lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

extension View {
    @ViewBuilder func flowBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { color }
        } else {
            frame(maxWidth: .infinity, maxHeight: .infinity).padding(16).background(color)
        }
    }
}

struct FlowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CEFlow", provider: Provider()) { FlowView(entry: $0) }
            .configurationDisplayName(ru ? "Доход и остаток" : "Income & what’s left")
            .description(ru ? "Доход за месяц, сколько потрачено и сколько осталось." : "Monthly income, how much is spent and what’s left.")
            .supportedFamilies([.systemMedium])
    }
}

@main
struct CEWidgetsBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        HeroCardWidget()
        FlowWidget()
        MonthWidget()
        TodayWidget()
        BreakdownWidget()
        GoalWidget()
        LockWidget()
    }
}

// Пример для галереи виджетов, пока приложение ещё не передало данные
enum Preview {
    static let snap: Snapshot? = {
        let json = """
        {"updatedAt":0,"month":"\(ru ? "Октябрь" : "October")","total":"฿28,450","today":"฿620","perDay":"฿1,016","forecast":"฿31,500",
        "income":"฿40,000","left":"฿11,550","usedShare":0.71,"over":false,"solo":false,
        "split":{"a":{"name":"Alex","amount":"฿9,200","share":0.32},"b":{"name":"Sam","amount":"฿6,750","share":0.24},"shared":{"amount":"฿12,500","share":0.44}},
        "topCategories":[{"name":"\(ru ? "Жильё" : "Housing")","amount":"฿12,000","share":0.42,"color":"#7F77DD"},{"name":"\(ru ? "Продукты" : "Groceries")","amount":"฿7,300","share":0.26,"color":"#EF9F27"},{"name":"\(ru ? "Рестораны" : "Restaurants")","amount":"฿4,100","share":0.14,"color":"#E24B4A"},{"name":"\(ru ? "Транспорт" : "Transport")","amount":"฿2,050","share":0.07,"color":"#378ADD"}],
        "goal":{"name":"\(ru ? "Отпуск на Бали" : "Bali trip")","saved":"฿18,000","target":"฿60,000","share":0.3},
        "last":{"title":"Tops Kamala","amount":"฿1,794"},"count":42,
        "flow":{"incomeLabel":"\(ru ? "Доход за месяц" : "Monthly income")","income":"฿40,000","leftLabel":"\(ru ? "Осталось" : "Left")","left":"฿11,550","negative":false,"spentPct":71,"savedPct":0,"spentText":"\(ru ? "Потрачено" : "Spent") ฿28,450 · 71%","savedText":null},
        "hero":{"label":"\(ru ? "Потратили вместе" : "Spent together")","meta":"\(ru ? "42 транзакции · ≈ 1 016 ฿ в день" : "42 transactions · ≈ ฿1,016 a day")","income":"\(ru ? "Осталось <b>11 550 ฿</b> из 40 000 ฿" : "<b>฿11,550</b> left of ฿40,000")"},
        "l":{"spent":"\(ru ? "Потрачено вместе" : "Spent together")","today":"\(ru ? "Сегодня" : "Today")","perDay":"\(ru ? "в день" : "a day")","forecast":"\(ru ? "Прогноз" : "Forecast")","left":"\(ru ? "Осталось" : "Left")","over":"\(ru ? "Перерасход" : "Over by")","of":"\(ru ? "из" : "of")","shared":"\(ru ? "Общее" : "Shared")","top":"\(ru ? "Больше всего" : "Top spending")","goal":"\(ru ? "Цель" : "Goal")","add":"\(ru ? "Расход" : "Expense")","voice":"\(ru ? "Голосом" : "Voice")","qr":"QR","last":"\(ru ? "Последний" : "Latest")","empty":"","noGoal":""}}
        """
        return try? JSONDecoder().decode(Snapshot.self, from: Data(json.utf8))
    }()
}
