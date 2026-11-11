import AVFoundation
import Capacitor
import UIKit

/// The pairing scanner: the camera draws behind the web view, which the page makes see-through while it scans, and each
/// QR code read is handed to the page. AVFoundation reads QR codes itself, so no scanning SDK ships in the app.
@objc(QrScannerPlugin)
public class QrScannerPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureMetadataOutputObjectsDelegate {
    public let identifier = "QrScannerPlugin"
    public let jsName = "QrScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isTorchAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorch", returnType: CAPPluginReturnPromise)
    ]

    private struct WebViewLook {
        let isOpaque: Bool
        let backgroundColor: UIColor?
        let scrollBackgroundColor: UIColor?
    }

    private let sessionQueue = DispatchQueue(label: "bot.dusk.mobile.qr-scanner")
    private var session: AVCaptureSession?
    private var device: AVCaptureDevice?
    private var previewView: UIView?
    private var webViewLook: WebViewLook?

    private func cameraState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["camera": cameraState()])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in
            call.resolve(["camera": self?.cameraState() ?? "denied"])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("settings unavailable")
                return
            }
            UIApplication.shared.open(url) { _ in call.resolve() }
        }
    }

    @objc func startScan(_ call: CAPPluginCall) {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            call.reject("camera permission was not granted")
            return
        }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.stopSession()
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) ?? AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: camera) else {
                call.reject("this device has no camera to scan with")
                return
            }
            let session = AVCaptureSession()
            let output = AVCaptureMetadataOutput()
            guard session.canAddInput(input), session.canAddOutput(output) else {
                call.reject("the camera could not be set up")
                return
            }
            session.beginConfiguration()
            session.addInput(input)
            session.addOutput(output)
            guard output.availableMetadataObjectTypes.contains(.qr) else {
                session.commitConfiguration()
                call.reject("this camera cannot read QR codes")
                return
            }
            output.metadataObjectTypes = [.qr]
            output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            session.commitConfiguration()
            self.session = session
            self.device = camera
            DispatchQueue.main.sync { self.showPreview(for: session) }
            session.startRunning()
            call.resolve()
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            self?.stopSession()
            call.resolve()
        }
    }

    @objc func isTorchAvailable(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            call.resolve(["available": self?.device?.hasTorch ?? false])
        }
    }

    @objc func setTorch(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        sessionQueue.async { [weak self] in
            guard let camera = self?.device, camera.hasTorch else {
                call.reject("no torch")
                return
            }
            do {
                try camera.lockForConfiguration()
                camera.torchMode = on ? .on : .off
                camera.unlockForConfiguration()
                call.resolve()
            } catch {
                call.reject("the torch could not be changed")
            }
        }
    }

    public func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        for object in metadataObjects {
            guard let code = object as? AVMetadataMachineReadableCodeObject, code.type == .qr, let text = code.stringValue else { continue }
            notifyListeners("codeScanned", data: ["text": text])
        }
    }

    /// Runs on the session queue.
    private func stopSession() {
        if let camera = device, camera.hasTorch, camera.torchMode != .off, (try? camera.lockForConfiguration()) != nil {
            camera.torchMode = .off
            camera.unlockForConfiguration()
        }
        session?.stopRunning()
        session = nil
        device = nil
        DispatchQueue.main.sync { self.hidePreview() }
    }

    private func showPreview(for session: AVCaptureSession) {
        guard let webView = bridge?.webView, let host = webView.superview else { return }
        let view = UIView(frame: host.bounds)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.backgroundColor = .black
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.addSublayer(layer)
        host.insertSubview(view, belowSubview: webView)
        previewView = view
        webViewLook = WebViewLook(isOpaque: webView.isOpaque, backgroundColor: webView.backgroundColor, scrollBackgroundColor: webView.scrollView.backgroundColor)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
    }

    private func hidePreview() {
        previewView?.removeFromSuperview()
        previewView = nil
        guard let webView = bridge?.webView, let look = webViewLook else { return }
        webView.isOpaque = look.isOpaque
        webView.backgroundColor = look.backgroundColor
        webView.scrollView.backgroundColor = look.scrollBackgroundColor
        webViewLook = nil
    }
}
