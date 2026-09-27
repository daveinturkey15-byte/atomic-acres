/** Mouse capture is optional in embedded browsers. A rejected request must
 * leave a usable, focused canvas rather than a live match with dead controls. */
export function requestGamePointerLock(
  canvas: { requestPointerLock?: () => unknown } | undefined,
  rejected: () => void,
): void {
  if (!canvas?.requestPointerLock) { rejected(); return; }
  try {
    void Promise.resolve(canvas.requestPointerLock()).catch(rejected);
  } catch { rejected(); }
}

export function gamePointerActive(canvas: EventTarget | undefined, freeCursor: boolean): boolean {
  return document.hasFocus() && (document.pointerLockElement === canvas || freeCursor);
}

/** With a free cursor only a right-button drag over the game turns the camera.
 * Normal cursor movement and movement over menus never steer the player. */
export function gamePointerLook(event: MouseEvent, canvas: EventTarget, freeCursor: boolean): boolean {
  return document.hasFocus() && (document.pointerLockElement === canvas
    || (freeCursor && event.target === canvas && (event.buttons & 2) !== 0));
}
