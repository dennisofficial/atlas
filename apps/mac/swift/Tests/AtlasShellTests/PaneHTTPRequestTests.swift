import XCTest

@testable import AtlasShellCore

final class PaneHTTPRequestTests: XCTestCase {
    private func bytes(_ text: String) -> Data {
        Data(text.utf8)
    }

    func testReadsThePaneCommandOutOfABody() {
        let body = #"{"kind":"hide"}"#
        let request = "POST /pane HTTP/1.1\r\nhost: 127.0.0.1\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
        XCTAssertEqual(
            PaneHTTPRequest.parse(bytes(request)),
            .request(method: "POST", path: "/pane", body: bytes(body))
        )
    }

    func testWaitsForTheBodyItWasPromised() {
        let head = "POST /pane HTTP/1.1\r\ncontent-length: 16\r\n\r\n{\"kind\":\"hide\"}"
        XCTAssertEqual(PaneHTTPRequest.parse(bytes(head)), .incomplete)
    }

    func testWaitsForTheHeadToEnd() {
        XCTAssertEqual(PaneHTTPRequest.parse(bytes("POST /pane HTTP/1.1\r\nhost: x\r\n")), .incomplete)
    }

    func testRejectsAHeadWithNoRequestLine() {
        XCTAssertEqual(PaneHTTPRequest.parse(bytes("\r\n\r\n")), .malformed)
    }

    func testRejectsABodyLongerThanItAllows() {
        let head = "POST /pane HTTP/1.1\r\ncontent-length: 99999999\r\n\r\n"
        XCTAssertEqual(PaneHTTPRequest.parse(bytes(head)), .malformed)
    }
}
