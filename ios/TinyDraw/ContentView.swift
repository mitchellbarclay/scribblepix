import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
            .background(Color("LaunchBackground"))   // shows behind the canvas during load
    }
}

#Preview {
    ContentView()
}
