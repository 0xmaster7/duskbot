import Capacitor
import UIKit

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(QrScannerPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(SpeechRecognizerPlugin())
    }
}
