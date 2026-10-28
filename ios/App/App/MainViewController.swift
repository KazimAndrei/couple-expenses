import UIKit
import Capacitor

// Регистрируем локальные плагины приложения (живут в таргете App, не в npm-пакетах)
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SlipScannerPlugin())
    }
}
