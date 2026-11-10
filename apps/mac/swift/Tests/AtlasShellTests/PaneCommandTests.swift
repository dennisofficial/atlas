import XCTest

@testable import AtlasShellCore

final class PaneCommandTests: XCTestCase {
    func testDecodesEveryKind() throws {
        let cases: [(String, PaneCommand)] = [
            (
                #"{"kind":"show","url":"https://example.com","rect":{"x":600,"y":0,"width":680,"height":820}}"#,
                .show(
                    url: "https://example.com",
                    rect: PaneRect(x: 600, y: 0, width: 680, height: 820)
                )
            ),
            (#"{"kind":"hide"}"#, .hide),
            (#"{"kind":"setRect","rect":{"x":1.5,"y":2.5,"width":3,"height":4}}"#, .setRect(PaneRect(x: 1.5, y: 2.5, width: 3, height: 4))),
            (#"{"kind":"navigate","url":"https://atlas.dev"}"#, .navigate(url: "https://atlas.dev")),
            (#"{"kind":"back"}"#, .back),
            (#"{"kind":"forward"}"#, .forward),
            (#"{"kind":"reload"}"#, .reload),
            (#"{"kind":"stop"}"#, .stop),
            (#"{"kind":"setObscured","obscured":true}"#, .setObscured(true)),
        ]
        for (json, expected) in cases {
            XCTAssertEqual(try PaneCommand.decode(from: Data(json.utf8)), expected, json)
        }
    }

    func testRejectsBodiesTheContractRejects() {
        let rejected = [
            "null",
            "[]",
            #"{"kind":"explode"}"#,
            #"{"rect":{"x":0,"y":0,"width":1,"height":1}}"#,
            #"{"kind":"show","rect":{"x":0,"y":0,"width":1,"height":1}}"#,
            #"{"kind":"show","url":"","rect":{"x":0,"y":0,"width":1,"height":1}}"#,
            #"{"kind":"show","url":"https://example.com"}"#,
            #"{"kind":"setRect","rect":{"x":0,"y":0,"width":-1,"height":1}}"#,
            #"{"kind":"setRect","rect":{"x":0,"y":0,"width":1}}"#,
            #"{"kind":"setRect","rect":{"x":"0","y":0,"width":1,"height":1}}"#,
            #"{"kind":"setObscured","obscured":"yes"}"#,
            #"{"kind":"setObscured"}"#,
        ]
        for json in rejected {
            XCTAssertThrowsError(try PaneCommand.decode(from: Data(json.utf8)), json)
        }
    }

    func testNamesTheOffendingField() {
        XCTAssertThrowsError(try PaneCommand.decode(from: Data(#"{"kind":"navigate"}"#.utf8))) { error in
            XCTAssertEqual(error as? PaneCommandError, .badField("url"))
        }
        XCTAssertThrowsError(try PaneCommand.decode(from: Data(#"{"kind":"jump"}"#.utf8))) { error in
            XCTAssertEqual(error as? PaneCommandError, .unknownKind("jump"))
        }
    }
}
