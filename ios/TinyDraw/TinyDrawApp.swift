import SwiftUI

@main
struct TinyDrawApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)   // hides the home indicator while drawing
        }
    }
}
