import Foundation
import WebKit

/// Serves the bundled web app (the `web/` folder inside the app bundle) over a
/// custom `tinydraw-app://local/...` origin.
///
/// A real origin — not `file://` — is required so that ES module imports,
/// module Web Workers, and `fetch()` of `.riv` assets all behave exactly as they
/// do under `npm start` on localhost. See CLAUDE.md for why `file://` breaks them.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    /// Must not collide with a scheme WebKit already handles (http, https, file…).
    static let scheme = "tinydraw-app"

    /// …/TinyDraw.app/web — the synced copy of the web app inside the bundle.
    private static let webRoot: URL? = {
        Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)
    }()

    private static let mimeTypes: [String: String] = [
        "html": "text/html",
        "htm": "text/html",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "css": "text/css",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "riv": "application/octet-stream",
        "wasm": "application/wasm",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "otf": "font/otf",
        "map": "application/json"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let root = Self.webRoot else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        // Map the URL path onto a file under the web root; "/" → index.html.
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        if path.hasPrefix("/") { path.removeFirst() }

        let fileURL = root.appendingPathComponent(path).standardizedFileURL

        // Refuse anything that escapes the web root (path-traversal guard).
        guard fileURL.path.hasPrefix(root.standardizedFileURL.path) else {
            urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
            return
        }

        guard let data = try? Data(contentsOf: fileURL) else {
            // Real 404 so a fetch() caller sees a status code rather than hanging.
            let resp = HTTPURLResponse(url: url, statusCode: 404,
                                       httpVersion: "HTTP/1.1", headerFields: nil)!
            urlSchemeTask.didReceive(resp)
            urlSchemeTask.didFinish()
            return
        }

        let ext = fileURL.pathExtension.lowercased()
        let mime = Self.mimeTypes[ext] ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: [
                                       "Content-Type": mime,
                                       "Content-Length": String(data.count),
                                       "Access-Control-Allow-Origin": "*",
                                       "Cache-Control": "no-cache"
                                   ])!
        urlSchemeTask.didReceive(resp)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
