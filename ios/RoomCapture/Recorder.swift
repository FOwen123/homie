import ARKit
import AVFoundation
import Foundation

/// Records an ARKit walk-around: video frames plus, for every saved frame, the camera pose and
/// intrinsics ARKit computed live. Output folder: Documents/captures/<timestamp>/
///   video.mov       H.264, every 2nd ARKit frame (~30 fps). Video frame i = line i of frames.jsonl
///   frames.jsonl    {i, t, tracking, transform (4x4 column-major, meters, world), intrinsics (3x3 column-major), w, h, light}
///   features.jsonl  sparse 3D feature points (world, meters) every 10th saved frame
///   planes.json     every detected plane at stop: transform, extent, polygon, alignment, classification
///   meta.json       device, iOS, duration, frame count
final class Recorder: NSObject, ObservableObject, ARSessionDelegate {
    @Published var isRecording = false
    @Published var tracking = "Starting…"
    @Published var horizontalPlanes = 0
    @Published var verticalPlanes = 0
    @Published var savedFrames = 0
    @Published var seconds = 0.0
    @Published var lastCapture: URL?
    @Published var error: String?

    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var framesHandle: FileHandle?
    private var featuresHandle: FileHandle?
    private var folder: URL?
    private var startTime: TimeInterval?
    private var arFrameCount = 0
    private weak var session: ARSession?

    static var capturesRoot: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("captures")
    }

    func attach(_ session: ARSession) {
        self.session = session
        session.delegate = self
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        // Highest-resolution 4:3 format that still runs at 60 fps.
        if let format = ARWorldTrackingConfiguration.supportedVideoFormats
            .filter({ $0.framesPerSecond >= 60 })
            .max(by: { $0.imageResolution.width < $1.imageResolution.width }) {
            config.videoFormat = format
        }
        session.run(config)
    }

    func start() {
        guard !isRecording else { return }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let dir = Self.capturesRoot.appendingPathComponent(stamp)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: dir.appendingPathComponent("frames.jsonl").path, contents: nil)
            FileManager.default.createFile(atPath: dir.appendingPathComponent("features.jsonl").path, contents: nil)
            framesHandle = try FileHandle(forWritingTo: dir.appendingPathComponent("frames.jsonl"))
            featuresHandle = try FileHandle(forWritingTo: dir.appendingPathComponent("features.jsonl"))
            writer = try AVAssetWriter(outputURL: dir.appendingPathComponent("video.mov"), fileType: .mov)
        } catch {
            self.error = "Could not start: \(error.localizedDescription)"
            return
        }
        folder = dir
        startTime = nil
        arFrameCount = 0
        savedFrames = 0
        seconds = 0
        error = nil
        isRecording = true
    }

    func stop() {
        guard isRecording, let dir = folder else { return }
        isRecording = false
        let anchors = session?.currentFrame?.anchors ?? []
        writeJSON(planesJSON(anchors), to: dir.appendingPathComponent("planes.json"))
        writeJSON([
            "device": deviceModel(),
            "ios": UIDevice.current.systemVersion,
            "seconds": seconds,
            "frames": savedFrames,
            "coordinates": "ARKit world, meters, y up, gravity aligned; transforms column-major",
        ], to: dir.appendingPathComponent("meta.json"))
        try? framesHandle?.close()
        try? featuresHandle?.close()
        input?.markAsFinished()
        let finishedWriter = writer
        writer = nil; input = nil; adaptor = nil
        finishedWriter?.finishWriting { [weak self] in
            DispatchQueue.main.async {
                if finishedWriter?.status == .failed {
                    self?.error = "Video failed: \(finishedWriter?.error?.localizedDescription ?? "unknown")"
                }
                self?.lastCapture = dir
            }
        }
    }

    // MARK: ARSessionDelegate

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        tracking = Self.describe(frame.camera.trackingState)
        guard isRecording else { return }
        arFrameCount += 1
        guard arFrameCount % 2 == 0 else { return } // ~30 fps

        let buffer = frame.capturedImage
        if writer?.status == .unknown { setUpWriter(for: buffer, at: frame.timestamp) }
        guard let start = startTime, let input, let adaptor, input.isReadyForMoreMediaData else { return }

        let time = CMTime(seconds: frame.timestamp - start, preferredTimescale: 600)
        guard adaptor.append(buffer, withPresentationTime: time) else { return }

        let i = savedFrames
        let record: [String: Any] = [
            "i": i,
            "t": frame.timestamp - start,
            "tracking": tracking,
            "transform": Self.flat(frame.camera.transform),
            "intrinsics": Self.flat(frame.camera.intrinsics),
            "w": CVPixelBufferGetWidth(buffer),
            "h": CVPixelBufferGetHeight(buffer),
            "light": frame.lightEstimate.map { ["ambient": $0.ambientIntensity, "kelvin": $0.ambientColorTemperature] } ?? NSNull(),
        ]
        appendLine(record, to: framesHandle)

        if i % 10 == 0, let points = frame.rawFeaturePoints?.points, !points.isEmpty {
            appendLine(["i": i, "points": points.map { [$0.x, $0.y, $0.z] }], to: featuresHandle)
        }
        savedFrames = i + 1
        seconds = frame.timestamp - start
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { countPlanes(session) }
    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) { countPlanes(session) }
    func session(_ session: ARSession, didFailWithError error: Error) { self.error = error.localizedDescription }

    // MARK: helpers

    private func setUpWriter(for buffer: CVPixelBuffer, at timestamp: TimeInterval) {
        guard let writer else { return }
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: CVPixelBufferGetWidth(buffer),
            AVVideoHeightKey: CVPixelBufferGetHeight(buffer),
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000], // ~60 MB per 60 s: under the 100 MB upload limit
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        // Pixels stay in sensor (landscape) orientation to match the intrinsics; this only tells players to show it upright.
        input.transform = CGAffineTransform(rotationAngle: .pi / 2)
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        guard writer.canAdd(input) else { error = "Video writer rejected input"; return }
        writer.add(input)
        guard writer.startWriting() else { error = "Video writer: \(writer.error?.localizedDescription ?? "failed")"; return }
        writer.startSession(atSourceTime: .zero)
        self.input = input
        self.adaptor = adaptor
        startTime = timestamp
    }

    private func countPlanes(_ session: ARSession) {
        let planes = (session.currentFrame?.anchors ?? []).compactMap { $0 as? ARPlaneAnchor }
        horizontalPlanes = planes.filter { $0.alignment == .horizontal }.count
        verticalPlanes = planes.filter { $0.alignment == .vertical }.count
    }

    private func planesJSON(_ anchors: [ARAnchor]) -> [[String: Any]] {
        anchors.compactMap { $0 as? ARPlaneAnchor }.map { p in
            [
                "id": p.identifier.uuidString,
                "alignment": p.alignment == .horizontal ? "horizontal" : "vertical",
                "classification": Self.describe(p.classification),
                "transform": Self.flat(p.transform),
                "center": [p.center.x, p.center.y, p.center.z],
                "extent": ["width": p.planeExtent.width, "height": p.planeExtent.height, "rotationOnYAxis": p.planeExtent.rotationOnYAxis],
                "boundary": p.geometry.boundaryVertices.map { [$0.x, $0.y, $0.z] },
            ]
        }
    }

    private func appendLine(_ object: Any, to handle: FileHandle?) {
        guard let handle, var data = try? JSONSerialization.data(withJSONObject: object) else { return }
        data.append(0x0A)
        handle.write(data)
    }

    private func writeJSON(_ object: Any, to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url)
    }

    private func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(cString: $0.bindMemory(to: CChar.self).baseAddress!) }
    }

    static func flat(_ m: simd_float4x4) -> [Float] { [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] } }
    static func flat(_ m: simd_float3x3) -> [Float] { [m.columns.0, m.columns.1, m.columns.2].flatMap { [$0.x, $0.y, $0.z] } }

    static func describe(_ state: ARCamera.TrackingState) -> String {
        switch state {
        case .normal: return "Normal"
        case .notAvailable: return "Not available"
        case .limited(.initializing): return "Limited: initializing"
        case .limited(.excessiveMotion): return "Limited: moving too fast"
        case .limited(.insufficientFeatures): return "Limited: not enough detail"
        case .limited(.relocalizing): return "Limited: relocalizing"
        case .limited: return "Limited"
        }
    }

    static func describe(_ c: ARPlaneAnchor.Classification) -> String {
        switch c {
        case .wall: return "wall"
        case .floor: return "floor"
        case .ceiling: return "ceiling"
        case .table: return "table"
        case .seat: return "seat"
        case .door: return "door"
        case .window: return "window"
        default: return "none"
        }
    }
}
