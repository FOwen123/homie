import Foundation

/// Uploads a finished capture to the Roomie website and follows processing until the room page is live.
@MainActor
final class Uploader: ObservableObject {
    static let site = URL(string: "https://roomie-tw.pages.dev")!
    enum Phase: Equatable { case idle, uploading, processing(String), done(URL), failed(String) }
    @Published var phase: Phase = .idle

    func upload(_ folder: URL) {
        phase = .uploading
        Task {
            do {
                let id = try await send(folder)
                try await follow(id)
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    private func send(_ folder: URL) async throws -> String {
        let boundary = "roomie-\(UUID().uuidString)"
        let body = FileManager.default.temporaryDirectory.appendingPathComponent("\(boundary).body")
        FileManager.default.createFile(atPath: body.path, contents: nil)
        let out = try FileHandle(forWritingTo: body)
        for name in ["video.mov", "frames.jsonl", "features.jsonl", "planes.json", "meta.json"] {
            out.write(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(name)\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8))
            out.write(try Data(contentsOf: folder.appendingPathComponent(name), options: .mappedIfSafe))
            out.write(Data("\r\n".utf8))
        }
        out.write(Data("--\(boundary)--\r\n".utf8))
        try out.close()
        defer { try? FileManager.default.removeItem(at: body) }

        var req = URLRequest(url: Self.site.appendingPathComponent("api/upload"))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 600
        let (data, res) = try await URLSession.shared.upload(for: req, fromFile: body)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (res as? HTTPURLResponse)?.statusCode == 200, let id = json?["id"] as? String else {
            throw NSError(domain: "Roomie", code: 1, userInfo: [NSLocalizedDescriptionKey: (json?["error"] as? String) ?? "Upload failed"])
        }
        return id
    }

    private func follow(_ id: String) async throws {
        while true {
            try await Task.sleep(for: .seconds(4))
            let (data, _) = try await URLSession.shared.data(from: Self.site.appendingPathComponent("api/status/\(id)"))
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            switch json["state"] as? String {
            case "done": phase = .done(Self.site.appendingPathComponent("room/\(id)")); return
            case "failed": throw NSError(domain: "Roomie", code: 2, userInfo: [NSLocalizedDescriptionKey: (json["error"] as? String) ?? "Processing failed"])
            case "publishing": phase = .processing("Publishing your room…")
            default: phase = .processing((json["step"] as? String).map { "Processing: \($0)" } ?? "Waiting in line…")
            }
        }
    }
}
