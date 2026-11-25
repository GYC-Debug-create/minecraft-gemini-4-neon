/**
 * Unified keyboard, mouse, pointer-lock, scroll, and virtual test input manager.
 * Virtual key state injected by window.__game merges seamlessly with physical keyboard input.
 */
export class InputManager {
  private readonly physicalKeys = new Set<string>();
  private readonly virtualKeys = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private leftDown = false;
  private rightDown = false;
  private virtualLeftDown = false;
  private virtualRightDown = false;
  private pointerLocked = false;
  private lastWPressTime = 0;
  private doubleTapSprint = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly listeners: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  private bindEvents(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.physicalKeys.has(e.code)) {
        this.pressedThisFrame.add(e.code);
        if (e.code === 'KeyW') {
          const now = performance.now();
          if (now - this.lastWPressTime < 280) {
            this.doubleTapSprint = true;
          }
          this.lastWPressTime = now;
        }
      }
      this.physicalKeys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F3'].includes(e.code)) {
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      this.physicalKeys.delete(e.code);
      if (e.code === 'KeyW') {
        this.doubleTapSprint = false;
      }
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (!this.pointerLocked) return;
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    };

    const onMouseDown = (e: MouseEvent): void => {
      if (!this.pointerLocked) return;
      if (e.button === 0) this.leftDown = true;
      if (e.button === 2) this.rightDown = true;
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    };

    const onWheel = (e: WheelEvent): void => {
      if (!this.pointerLocked) return;
      this.wheelDelta += Math.sign(e.deltaY);
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onPointerLockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) {
        this.leftDown = false;
        this.rightDown = false;
      }
    };

    const onBlur = (): void => {
      this.physicalKeys.clear();
      this.leftDown = false;
      this.rightDown = false;
      this.doubleTapSprint = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    this.canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('blur', onBlur);

    this.listeners.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => window.removeEventListener('wheel', onWheel),
      () => this.canvas.removeEventListener('contextmenu', onContextMenu),
      () => document.removeEventListener('pointerlockchange', onPointerLockChange),
      () => window.removeEventListener('blur', onBlur)
    );
  }

  requestPointerLock(): void {
    try {
      this.canvas.requestPointerLock?.();
    } catch {
      // Ignore in headless/sandboxed browsers
    }
  }

  exitPointerLock(): void {
    try {
      if (document.pointerLockElement) document.exitPointerLock?.();
    } catch {
      // Ignore
    }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isDown(code: string): boolean {
    return this.physicalKeys.has(code) || this.virtualKeys.has(code);
  }

  isSprintingInput(): boolean {
    return (
      this.isDown('ControlLeft') ||
      this.isDown('ControlRight') ||
      (this.doubleTapSprint && this.isDown('KeyW'))
    );
  }

  isSneakingInput(): boolean {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  consumePress(code: string): boolean {
    if (this.pressedThisFrame.has(code)) {
      this.pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  clearPressedFrame(): void {
    this.pressedThisFrame.clear();
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const res = { dx: this.mouseDeltaX, dy: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return res;
  }

  consumeWheelDelta(): number {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  isLeftMouseDown(): boolean {
    return this.leftDown || this.virtualLeftDown;
  }

  isRightMouseDown(): boolean {
    return this.rightDown || this.virtualRightDown;
  }

  /** Virtual input controls for automated E2E testing via window.__game */
  setVirtualKey(code: string, down: boolean): void {
    if (code === 'MouseLeft') {
      this.virtualLeftDown = down;
      return;
    }
    if (code === 'MouseRight') {
      this.virtualRightDown = down;
      return;
    }
    if (down) {
      if (!this.virtualKeys.has(code)) {
        this.pressedThisFrame.add(code);
      }
      this.virtualKeys.add(code);
    } else {
      this.virtualKeys.delete(code);
    }
  }

  releaseAllVirtualKeys(): void {
    this.virtualKeys.clear();
    this.virtualLeftDown = false;
    this.virtualRightDown = false;
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }
}
