import SwiftUI
import WebKit

/// Full-screen WKWebView that hosts the bundled Tiny Draw web app.
///
/// The web app is served over the custom `tinydraw-app://` origin (see
/// `AppSchemeHandler`) rather than `file://`, because Tiny Draw relies on ES
/// module imports, a module Web Worker, and `fetch()` of `.riv` assets — all of
/// which WebKit blocks under the opaque `file://` origin.
struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.allowsBackForwardNavigationGestures = false

        // Lock the page down so it feels native: no scroll, no rubber-band
        // bounce, no pinch-zoom of the whole document.
        let scroll = webView.scrollView
        scroll.isScrollEnabled = false
        scroll.bounces = false
        scroll.bouncesZoom = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.pinchGestureRecognizer?.isEnabled = false
        scroll.maximumZoomScale = 1
        scroll.minimumZoomScale = 1

        // Enables Safari → Develop → [device] Web Inspector for on-device debugging.
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }

        let start = URL(string: "\(AppSchemeHandler.scheme)://local/index.html")!
        webView.load(URLRequest(url: start))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
