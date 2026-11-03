import ARKit
import RealityKit
import SwiftUI

@main
struct RoomCaptureApp: App {
    var body: some SwiftUI.Scene {
        WindowGroup { CaptureView() }
    }
}

struct CaptureView: View {
    @StateObject private var recorder = Recorder()
    @StateObject private var uploader = Uploader()
    @State private var sharing = false
    @Environment(\.openURL) private var openURL

    @ViewBuilder private var uploadStatus: some View {
        switch uploader.phase {
        case .idle: if recorder.lastCapture != nil { Button("Share files") { sharing = true }.font(.footnote).foregroundStyle(.white) }
        case .uploading: Label("Uploading your room…", systemImage: "arrow.up.circle").statusPill()
        case .processing(let step): Label(step, systemImage: "gearshape.2").statusPill()
        case .done(let url):
            Button { openURL(url) } label: { Label("Open my room", systemImage: "cube.transparent") }
                .font(.headline).padding(.horizontal, 20).frame(height: 48).background(.white, in: Capsule()).foregroundStyle(.black)
        case .failed(let why): Label(why, systemImage: "exclamationmark.triangle").statusPill()
        }
    }

    var body: some View {
        ZStack {
            ARContainer(recorder: recorder).ignoresSafeArea()
            VStack(spacing: 8) {
                status
                Spacer()
                if let error = recorder.error {
                    Text(error).font(.footnote).foregroundStyle(.white).padding(8)
                        .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
                }
                if !recorder.isRecording {
                    Text("Point at the floor, then walk slowly along every wall. Show each piece of furniture from two sides.")
                        .font(.footnote).multilineTextAlignment(.center).foregroundStyle(.white)
                        .padding(10).background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                }
                HStack(spacing: 16) {
                    Button(recorder.isRecording ? "Stop" : "Record") {
                        recorder.isRecording ? recorder.stop() : recorder.start()
                    }
                    .font(.title2.bold()).frame(width: 140, height: 56)
                    .background(recorder.isRecording ? Color.red : Color.white, in: Capsule())
                    .foregroundStyle(recorder.isRecording ? .white : .black)

                    if let capture = recorder.lastCapture, !recorder.isRecording {
                        Button("Upload") { uploader.upload(capture) }
                            .font(.title3.bold()).frame(width: 120, height: 56)
                            .background(Color(red: 0, green: 0.41, blue: 0.88), in: Capsule()).foregroundStyle(.white)
                            .disabled(uploader.phase == .uploading)
                    }
                }
                uploadStatus
                .padding(.bottom, 24)
            }
            .padding()
        }
        .sheet(isPresented: $sharing) {
            if let url = recorder.lastCapture { ShareSheet(items: shareItems(url)) }
        }
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Tracking: \(recorder.tracking)")
                .foregroundStyle(recorder.tracking == "Normal" ? .green : .yellow)
            Text("Planes: \(recorder.horizontalPlanes) floor/table · \(recorder.verticalPlanes) wall")
            if recorder.isRecording {
                Text(String(format: "● REC %.0f s · %d frames", recorder.seconds, recorder.savedFrames)).foregroundStyle(.red)
            } else if let url = recorder.lastCapture {
                Text("Saved: \(url.lastPathComponent)")
            }
        }
        .font(.caption.monospaced()).foregroundStyle(.white)
        .padding(8).background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func shareItems(_ folder: URL) -> [Any] {
        (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    }
}

struct ARContainer: UIViewRepresentable {
    let recorder: Recorder

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.debugOptions = [.showFeaturePoints] // yellow dots: what ARKit has seen; the recording itself is the clean camera image
        recorder.attach(view.session)
        let coaching = ARCoachingOverlayView()
        coaching.session = view.session
        coaching.goal = .horizontalPlane
        coaching.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(coaching)
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {}
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension View {
    func statusPill() -> some View {
        font(.footnote).foregroundStyle(.white).padding(.horizontal, 14).padding(.vertical, 10)
            .background(.black.opacity(0.6), in: Capsule())
    }
}
