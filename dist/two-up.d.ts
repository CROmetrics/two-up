type TwoUpOrientation = "horizontal" | "vertical";
/**
 * A split view that the user can adjust. The first child becomes
 * the left-hand side, and the second child becomes the right-hand side.
 */
export default class TwoUp extends HTMLElement {
    static get observedAttributes(): string[];
    private readonly _handle;
    /**
     * The position of the split in pixels.
     */
    private _position;
    /**
     * The position of the split in %.
     */
    private _relativePosition;
    /**
     * The value of _position when the pointer went down.
     */
    private _positionOnPointerStart;
    /**
     * Has connectedCallback been called yet?
     */
    private _everConnected;
    /**
     * Has the initial position been set yet?
     */
    private _initialPositionSet;
    private _resizeObserver?;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string): void;
    private _resetPosition;
    /**
     * If true, this element works in browsers that don't support clip-path (Edge).
     * However, this means you'll have to set the height of this element manually.
     */
    get legacyClipCompat(): boolean;
    set legacyClipCompat(val: boolean);
    /**
     * Split vertically rather than horizontally.
     */
    get orientation(): TwoUpOrientation;
    set orientation(val: TwoUpOrientation);
    get initialposition(): number;
    set initialposition(val: number);
    /**
     * Called when element's child list changes
     */
    private _childrenChange;
    /**
     * Called when a pointer moves.
     */
    private _pointerChange;
    private _setPosition;
}
export {};
