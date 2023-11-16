var TwoUp = (function () {
    'use strict';

    class Pointer {
        constructor(nativePointer) {
            /** Unique ID for this pointer */
            this.id = -1;
            this.nativePointer = nativePointer;
            this.pageX = nativePointer.pageX;
            this.pageY = nativePointer.pageY;
            this.clientX = nativePointer.clientX;
            this.clientY = nativePointer.clientY;
            if (self.Touch && nativePointer instanceof Touch) {
                this.id = nativePointer.identifier;
            }
            else if (isPointerEvent(nativePointer)) {
                // is PointerEvent
                this.id = nativePointer.pointerId;
            }
        }
        /**
         * Returns an expanded set of Pointers for high-resolution inputs.
         */
        getCoalesced() {
            if ('getCoalescedEvents' in this.nativePointer) {
                const events = this.nativePointer
                    .getCoalescedEvents()
                    .map((p) => new Pointer(p));
                // Firefox sometimes returns an empty list here. I'm not sure it's doing the right thing.
                // https://github.com/w3c/pointerevents/issues/409
                if (events.length > 0)
                    return events;
            }
            return [this];
        }
    }
    const isPointerEvent = (event) => 'pointerId' in event;
    const isTouchEvent = (event) => 'changedTouches' in event;
    const noop = () => { };
    /**
     * Track pointers across a particular element
     */
    class PointerTracker {
        /**
         * Track pointers across a particular element
         *
         * @param element Element to monitor.
         * @param options
         */
        constructor(_element, { start = () => true, move = noop, end = noop, rawUpdates = false, avoidPointerEvents = false, } = {}) {
            this._element = _element;
            /**
             * State of the tracked pointers when they were pressed/touched.
             */
            this.startPointers = [];
            /**
             * Latest state of the tracked pointers. Contains the same number of pointers, and in the same
             * order as this.startPointers.
             */
            this.currentPointers = [];
            /**
             * Firefox has a bug where touch-based pointer events have a `buttons` of 0, when this shouldn't
             * happen. https://bugzilla.mozilla.org/show_bug.cgi?id=1729440
             *
             * Usually we treat `buttons === 0` as no-longer-pressed. This set allows us to exclude these
             * buggy Firefox events.
             */
            this._excludeFromButtonsCheck = new Set();
            /**
             * Listener for mouse/pointer starts.
             *
             * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
             */
            this._pointerStart = (event) => {
                if (isPointerEvent(event) && event.buttons === 0) {
                    // This is the buggy Firefox case. See _excludeFromButtonsCheck.
                    this._excludeFromButtonsCheck.add(event.pointerId);
                }
                else if (!(event.buttons & 1 /* LeftMouseOrTouchOrPenDown */)) {
                    return;
                }
                const pointer = new Pointer(event);
                // If we're already tracking this pointer, ignore this event.
                // This happens with mouse events when multiple buttons are pressed.
                if (this.currentPointers.some((p) => p.id === pointer.id))
                    return;
                if (!this._triggerPointerStart(pointer, event))
                    return;
                // Add listeners for additional events.
                // The listeners may already exist, but no harm in adding them again.
                if (isPointerEvent(event)) {
                    const capturingElement = event.target && 'setPointerCapture' in event.target
                        ? event.target
                        : this._element;
                    capturingElement.setPointerCapture(event.pointerId);
                    this._element.addEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move);
                    this._element.addEventListener('pointerup', this._pointerEnd);
                    this._element.addEventListener('pointercancel', this._pointerEnd);
                }
                else {
                    // MouseEvent
                    window.addEventListener('mousemove', this._move);
                    window.addEventListener('mouseup', this._pointerEnd);
                }
            };
            /**
             * Listener for touchstart.
             * Only used if the browser doesn't support pointer events.
             */
            this._touchStart = (event) => {
                for (const touch of Array.from(event.changedTouches)) {
                    this._triggerPointerStart(new Pointer(touch), event);
                }
            };
            /**
             * Listener for pointer/mouse/touch move events.
             */
            this._move = (event) => {
                if (!isTouchEvent(event) &&
                    (!isPointerEvent(event) ||
                        !this._excludeFromButtonsCheck.has(event.pointerId)) &&
                    event.buttons === 0 /* None */) {
                    // This happens in a number of buggy cases where the browser failed to deliver a pointerup
                    // or pointercancel. If we see the pointer moving without any buttons down, synthesize an end.
                    // https://github.com/w3c/pointerevents/issues/407
                    // https://github.com/w3c/pointerevents/issues/408
                    this._pointerEnd(event);
                    return;
                }
                const previousPointers = this.currentPointers.slice();
                const changedPointers = isTouchEvent(event)
                    ? Array.from(event.changedTouches).map((t) => new Pointer(t))
                    : [new Pointer(event)];
                const trackedChangedPointers = [];
                for (const pointer of changedPointers) {
                    const index = this.currentPointers.findIndex((p) => p.id === pointer.id);
                    if (index === -1)
                        continue; // Not a pointer we're tracking
                    trackedChangedPointers.push(pointer);
                    this.currentPointers[index] = pointer;
                }
                if (trackedChangedPointers.length === 0)
                    return;
                this._moveCallback(previousPointers, trackedChangedPointers, event);
            };
            /**
             * Call the end callback for this pointer.
             *
             * @param pointer Pointer
             * @param event Related event
             */
            this._triggerPointerEnd = (pointer, event) => {
                // Main button still down?
                // With mouse events, you get a mouseup per mouse button, so the left button might still be down.
                if (!isTouchEvent(event) &&
                    event.buttons & 1 /* LeftMouseOrTouchOrPenDown */) {
                    return false;
                }
                const index = this.currentPointers.findIndex((p) => p.id === pointer.id);
                // Not a pointer we're interested in?
                if (index === -1)
                    return false;
                this.currentPointers.splice(index, 1);
                this.startPointers.splice(index, 1);
                this._excludeFromButtonsCheck.delete(pointer.id);
                // The event.type might be a 'move' event due to workarounds for weird mouse behaviour.
                // See _move for details.
                const cancelled = !(event.type === 'mouseup' ||
                    event.type === 'touchend' ||
                    event.type === 'pointerup');
                this._endCallback(pointer, event, cancelled);
                return true;
            };
            /**
             * Listener for mouse/pointer ends.
             *
             * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
             */
            this._pointerEnd = (event) => {
                if (!this._triggerPointerEnd(new Pointer(event), event))
                    return;
                if (isPointerEvent(event)) {
                    if (this.currentPointers.length)
                        return;
                    this._element.removeEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move);
                    this._element.removeEventListener('pointerup', this._pointerEnd);
                    this._element.removeEventListener('pointercancel', this._pointerEnd);
                }
                else {
                    // MouseEvent
                    window.removeEventListener('mousemove', this._move);
                    window.removeEventListener('mouseup', this._pointerEnd);
                }
            };
            /**
             * Listener for touchend.
             * Only used if the browser doesn't support pointer events.
             */
            this._touchEnd = (event) => {
                for (const touch of Array.from(event.changedTouches)) {
                    this._triggerPointerEnd(new Pointer(touch), event);
                }
            };
            this._startCallback = start;
            this._moveCallback = move;
            this._endCallback = end;
            this._rawUpdates = rawUpdates && 'onpointerrawupdate' in window;
            // Add listeners
            if (self.PointerEvent && !avoidPointerEvents) {
                this._element.addEventListener('pointerdown', this._pointerStart);
            }
            else {
                this._element.addEventListener('mousedown', this._pointerStart);
                this._element.addEventListener('touchstart', this._touchStart);
                this._element.addEventListener('touchmove', this._move);
                this._element.addEventListener('touchend', this._touchEnd);
                this._element.addEventListener('touchcancel', this._touchEnd);
            }
        }
        /**
         * Remove all listeners.
         */
        stop() {
            this._element.removeEventListener('pointerdown', this._pointerStart);
            this._element.removeEventListener('mousedown', this._pointerStart);
            this._element.removeEventListener('touchstart', this._touchStart);
            this._element.removeEventListener('touchmove', this._move);
            this._element.removeEventListener('touchend', this._touchEnd);
            this._element.removeEventListener('touchcancel', this._touchEnd);
            this._element.removeEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move);
            this._element.removeEventListener('pointerup', this._pointerEnd);
            this._element.removeEventListener('pointercancel', this._pointerEnd);
            window.removeEventListener('mousemove', this._move);
            window.removeEventListener('mouseup', this._pointerEnd);
        }
        /**
         * Call the start callback for this pointer, and track it if the user wants.
         *
         * @param pointer Pointer
         * @param event Related event
         * @returns Whether the pointer is being tracked.
         */
        _triggerPointerStart(pointer, event) {
            if (!this._startCallback(pointer, event))
                return false;
            this.currentPointers.push(pointer);
            this.startPointers.push(pointer);
            return true;
        }
    }

    function styleInject(css, ref) {
      if ( ref === void 0 ) ref = {};
      var insertAt = ref.insertAt;

      if (!css || typeof document === 'undefined') { return; }

      var head = document.head || document.getElementsByTagName('head')[0];
      var style = document.createElement('style');
      style.type = 'text/css';

      if (insertAt === 'top') {
        if (head.firstChild) {
          head.insertBefore(style, head.firstChild);
        } else {
          head.appendChild(style);
        }
      } else {
        head.appendChild(style);
      }

      if (style.styleSheet) {
        style.styleSheet.cssText = css;
      } else {
        style.appendChild(document.createTextNode(css));
      }
    }

    var scrubber = "styles_scrubber__39cN6";
    var twoUpHandle = "styles_two-up-handle__2kVsP";
    var css = "two-up{display:grid;position:relative;--split-point:0;--accent-color:#777;--track-color:var(--accent-color);--thumb-background:#fff;--thumb-color:var(--accent-color);--thumb-size:62px;--bar-size:6px;--bar-touch-size:30px}two-up>*{grid-area:1/1}two-up[legacy-clip-compat]>:not(.styles_two-up-handle__2kVsP){position:absolute}.styles_two-up-handle__2kVsP{touch-action:none;position:relative;width:var(--bar-touch-size);transform:translateX(var(--split-point)) translateX(-50%);will-change:transform;cursor:ew-resize}.styles_two-up-handle__2kVsP:before{content:\"\";display:block;height:100%;width:var(--bar-size);margin:0 auto;box-shadow:inset calc(var(--bar-size) / 2) 0 0 rgba(0,0,0,.1),0 1px 4px rgba(0,0,0,.4);background:var(--track-color)}.styles_scrubber__39cN6{display:flex;position:absolute;top:50%;left:50%;transform-origin:50% 50%;transform:translate(-50%,-50%);width:var(--thumb-size);height:calc(var(--thumb-size) * .9);background:var(--thumb-background);border:1px solid rgba(0,0,0,.2);border-radius:var(--thumb-size);box-shadow:0 1px 4px rgba(0,0,0,.1);color:var(--thumb-color);box-sizing:border-box;padding:0 calc(var(--thumb-size) * .24)}.styles_scrubber__39cN6 svg{flex:1}two-up[orientation=vertical] .styles_two-up-handle__2kVsP{width:auto;height:var(--bar-touch-size);transform:translateY(var(--split-point)) translateY(-50%);cursor:ns-resize}two-up[orientation=vertical] .styles_two-up-handle__2kVsP:before{width:auto;height:var(--bar-size);box-shadow:inset 0 calc(var(--bar-size) / 2) 0 rgba(0,0,0,.1),0 1px 4px rgba(0,0,0,.4);margin:calc((var(--bar-touch-size) - var(--bar-size)) / 2) 0 0}two-up[orientation=vertical] .styles_scrubber__39cN6{box-shadow:1px 0 4px rgba(0,0,0,.1);transform:translate(-50%,-50%) rotate(-90deg)}two-up>:first-child:not(.styles_two-up-handle__2kVsP){-webkit-clip-path:inset(0 calc(100% - var(--split-point)) 0 0);clip-path:inset(0 calc(100% - var(--split-point)) 0 0)}two-up>:nth-child(2):not(.styles_two-up-handle__2kVsP){-webkit-clip-path:inset(0 0 0 var(--split-point));clip-path:inset(0 0 0 var(--split-point))}two-up[orientation=vertical]>:first-child:not(.styles_two-up-handle__2kVsP){-webkit-clip-path:inset(0 0 calc(100% - var(--split-point)) 0);clip-path:inset(0 0 calc(100% - var(--split-point)) 0)}two-up[orientation=vertical]>:nth-child(2):not(.styles_two-up-handle__2kVsP){-webkit-clip-path:inset(var(--split-point) 0 0 0);clip-path:inset(var(--split-point) 0 0 0)}@supports not ((clip-path:inset(0 0 0 0)) or (-webkit-clip-path:inset(0 0 0 0))){two-up[legacy-clip-compat]>:first-child:not(.styles_two-up-handle__2kVsP){clip:rect(auto var(--split-point) auto auto)}two-up[legacy-clip-compat]>:nth-child(2):not(.styles_two-up-handle__2kVsP){clip:rect(auto auto auto var(--split-point))}two-up[orientation=vertical][legacy-clip-compat]>:first-child:not(.styles_two-up-handle__2kVsP){clip:rect(auto auto var(--split-point) auto)}two-up[orientation=vertical][legacy-clip-compat]>:nth-child(2):not(.styles_two-up-handle__2kVsP){clip:rect(var(--split-point) auto auto auto)}}";
    styleInject(css);

    const legacyClipCompatAttr = "legacy-clip-compat";
    const orientationAttr = "orientation";
    const initialPositionAttr = "initial-position";
    const sendCustomEvent = () => {
        window.dispatchEvent(new CustomEvent("twoUpHandleGrabbed"));
    };
    /**
     * A split view that the user can adjust. The first child becomes
     * the left-hand side, and the second child becomes the right-hand side.
     */
    class TwoUp extends HTMLElement {
        static get observedAttributes() {
            return [orientationAttr, initialPositionAttr];
        }
        constructor() {
            super();
            this._handle = document.createElement("div");
            /**
             * The position of the split in pixels.
             */
            this._position = 0;
            /**
             * The position of the split in %.
             */
            this._relativePosition = this.initialposition;
            /**
             * The value of _position when the pointer went down.
             */
            this._positionOnPointerStart = 0;
            /**
             * Has connectedCallback been called yet?
             */
            this._everConnected = false;
            /**
             * Has the initial position been set yet?
             */
            this._initialPositionSet = false;
            this._handle.className = twoUpHandle;
            // Watch for children changes.
            // Note this won't fire for initial contents,
            // so _childrenChange is also called in connectedCallback.
            new MutationObserver(() => this._childrenChange()).observe(this, {
                childList: true,
            });
            // Watch for pointers on the handle.
            const pointerTracker = new PointerTracker(this._handle, {
                start: (_, event) => {
                    // We only want to track 1 pointer.
                    if (pointerTracker.currentPointers.length === 1)
                        return false;
                    event.preventDefault();
                    sendCustomEvent();
                    this._positionOnPointerStart = this._position;
                    return true;
                },
                move: () => {
                    this._pointerChange(pointerTracker.startPointers[0], pointerTracker.currentPointers[0]);
                },
            });
        }
        connectedCallback() {
            this._childrenChange();
            this._handle.innerHTML = `<div class="${scrubber}">${`<svg viewBox="0 0 27 20" fill="currentColor">${'<path d="M17 19.2l9.5-9.6L16.9 0zM9.6 0L0 9.6l9.6 9.6z"/>'}</svg>`}</div>`;
            this._resizeObserver = new ResizeObserver(() => this._resetPosition());
            this._resizeObserver.observe(this);
            if (!this._everConnected) {
                this._resetPosition();
                this._everConnected = true;
            }
        }
        disconnectedCallback() {
            if (this._resizeObserver)
                this._resizeObserver.disconnect();
        }
        attributeChangedCallback(name) {
            if (name === orientationAttr) {
                this._resetPosition();
            }
            if (name === initialPositionAttr) {
                this._resetPosition();
            }
        }
        _resetPosition() {
            // Set the initial position of the handle.
            requestAnimationFrame(() => {
                const bounds = this.getBoundingClientRect();
                const dimensionAxis = this.orientation === "vertical" ? "height" : "width";
                if (this._relativePosition !== this.initialposition &&
                    !this._initialPositionSet) {
                    this._relativePosition = this.initialposition;
                    this._initialPositionSet = true;
                }
                this._position = bounds[dimensionAxis] * this._relativePosition;
                this._setPosition();
            });
        }
        /**
         * If true, this element works in browsers that don't support clip-path (Edge).
         * However, this means you'll have to set the height of this element manually.
         */
        get legacyClipCompat() {
            return this.hasAttribute(legacyClipCompatAttr);
        }
        set legacyClipCompat(val) {
            if (val) {
                this.setAttribute(legacyClipCompatAttr, "");
            }
            else {
                this.removeAttribute(legacyClipCompatAttr);
            }
        }
        /**
         * Split vertically rather than horizontally.
         */
        get orientation() {
            const value = this.getAttribute(orientationAttr);
            // This mirrors the behaviour of input.type, where setting just sets the attribute, but getting
            // returns the value only if it's valid.
            if (value && value.toLowerCase() === "vertical")
                return "vertical";
            return "horizontal";
        }
        set orientation(val) {
            this.setAttribute(orientationAttr, val);
        }
        get initialposition() {
            const value = this.getAttribute(initialPositionAttr);
            if (value === null || typeof value === "undefined")
                return 0.5;
            return parseFloat(value);
        }
        set initialposition(val) {
            this.setAttribute(initialPositionAttr, val.toString());
        }
        /**
         * Called when element's child list changes
         */
        _childrenChange() {
            // Ensure the handle is the last child.
            // The CSS depends on this.
            if (this.lastElementChild !== this._handle) {
                this.appendChild(this._handle);
            }
        }
        /**
         * Called when a pointer moves.
         */
        _pointerChange(startPoint, currentPoint) {
            const pointAxis = this.orientation === "vertical" ? "clientY" : "clientX";
            const dimensionAxis = this.orientation === "vertical" ? "height" : "width";
            const bounds = this.getBoundingClientRect();
            this._position =
                this._positionOnPointerStart +
                    (currentPoint[pointAxis] - startPoint[pointAxis]);
            // Clamp position to element bounds.
            this._position = Math.max(0, Math.min(this._position, bounds[dimensionAxis]));
            this._relativePosition = this._position / bounds[dimensionAxis];
            this._setPosition();
        }
        _setPosition() {
            this.style.setProperty("--split-point", `${this._position}px`);
        }
    }

    customElements.get("two-up") || customElements.define("two-up", TwoUp);

    return TwoUp;

}());
