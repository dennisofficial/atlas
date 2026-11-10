import CoreGraphics
import XCTest

@testable import AtlasShellCore

final class PaneGeometryTests: XCTestCase {
    func testFullRightHalfLandsOnTheContainerOrigin() {
        let rect = PaneRect(x: 600, y: 0, width: 680, height: 820)
        let container = CGRect(x: 600, y: 0, width: 680, height: 820)
        XCTAssertEqual(
            PaneGeometry.paneFrame(rect, inContainer: container, containerIsFlipped: true),
            CGRect(x: 0, y: 0, width: 680, height: 820)
        )
        XCTAssertEqual(
            PaneGeometry.paneFrame(rect, inContainer: container, containerIsFlipped: false),
            CGRect(x: 0, y: 0, width: 680, height: 820)
        )
    }

    func testNonFlippedContainerMeasuresUpFromItsBottom() {
        let rect = PaneRect(x: 700, y: 100, width: 200, height: 200)
        let container = CGRect(x: 600, y: 0, width: 680, height: 820)
        XCTAssertEqual(
            PaneGeometry.paneFrame(rect, inContainer: container, containerIsFlipped: false),
            CGRect(x: 100, y: 520, width: 200, height: 200)
        )
    }

    func testFlippedContainerMeasuresDownFromItsTop() {
        let rect = PaneRect(x: 700, y: 100, width: 200, height: 200)
        let container = CGRect(x: 600, y: 0, width: 680, height: 820)
        XCTAssertEqual(
            PaneGeometry.paneFrame(rect, inContainer: container, containerIsFlipped: true),
            CGRect(x: 100, y: 100, width: 200, height: 200)
        )
    }

    func testContainerBelowTheTitlebarShiftsTheRectDown() {
        let rect = PaneRect(x: 600, y: 40, width: 680, height: 780)
        let container = CGRect(x: 600, y: 40, width: 680, height: 780)
        XCTAssertEqual(
            PaneGeometry.paneFrame(rect, inContainer: container, containerIsFlipped: true),
            CGRect(x: 0, y: 0, width: 680, height: 780)
        )
    }

    func testWindowFrameBecomesATopLeftRect() {
        XCTAssertEqual(
            PaneGeometry.topLeftRect(
                windowFrame: CGRect(x: 600, y: 0, width: 680, height: 820),
                contentHeight: 820
            ),
            CGRect(x: 600, y: 0, width: 680, height: 820)
        )
        XCTAssertEqual(
            PaneGeometry.topLeftRect(
                windowFrame: CGRect(x: 600, y: 40, width: 680, height: 780),
                contentHeight: 820
            ),
            CGRect(x: 600, y: 0, width: 680, height: 780)
        )
    }
}
