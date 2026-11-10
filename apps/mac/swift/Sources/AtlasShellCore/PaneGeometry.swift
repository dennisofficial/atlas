import CoreGraphics

public enum PaneGeometry {
    public static func paneFrame(
        _ rect: PaneRect,
        inContainer container: CGRect,
        containerIsFlipped: Bool
    ) -> CGRect {
        let x = rect.x - container.minX
        let distanceFromContainerTop = rect.y - container.minY
        let y = containerIsFlipped
            ? distanceFromContainerTop
            : container.height - distanceFromContainerTop - rect.height
        return CGRect(x: x, y: y, width: rect.width, height: rect.height)
    }

    public static func topLeftRect(windowFrame frame: CGRect, contentHeight: CGFloat) -> CGRect {
        CGRect(x: frame.minX, y: contentHeight - frame.maxY, width: frame.width, height: frame.height)
    }
}
