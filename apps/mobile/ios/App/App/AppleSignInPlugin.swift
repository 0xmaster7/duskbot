import AuthenticationServices
import Capacitor
import UIKit

/// Sign in with Apple through the system sheet (AuthenticationServices), for the account service's native sign-in. The page
/// passes the SHA-256 of its own random nonce; Apple puts that in the identity token, the page sends the raw nonce on.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func signIn(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), nonce.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            call.reject("A nonce hash is required.", "invalid")
            return
        }
        DispatchQueue.main.async {
            if let previous = self.pending { previous.reject("Another sign-in started.", "canceled") }
            self.pending = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pending else { return }
        pending = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken, let identityToken = String(data: tokenData, encoding: .utf8),
              let codeData = credential.authorizationCode, let authorizationCode = String(data: codeData, encoding: .utf8) else {
            call.reject("Apple returned no token.", "failed")
            return
        }
        var result: [String: Any] = ["identityToken": identityToken, "authorizationCode": authorizationCode]
        if let given = credential.fullName?.givenName, !given.isEmpty { result["givenName"] = given }
        if let family = credential.fullName?.familyName, !family.isEmpty { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pending else { return }
        pending = nil
        let code = (error as? ASAuthorizationError)?.code
        call.reject("Sign in with Apple did not finish.", code == .canceled ? "canceled" : "failed")
    }
}
