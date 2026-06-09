export class PhaseTimer {
  constructor() {
    this._interval = null;
    this.expiresAt = 0;
  }

  start(remainingSeconds, { onTick, onExpire }) {
    this.stop();
    this.expiresAt = Date.now() + remainingSeconds * 1000;
    this._interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
      if (remaining <= 0) {
        this.stop();
        onExpire();
      } else {
        onTick(remaining);
      }
    }, 1000);
  }

  pause() {
    this.stop();
  }

  resume(remainingSeconds, callbacks) {
    this.start(remainingSeconds, callbacks);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.expiresAt = 0;
  }

  get running() {
    return this._interval !== null;
  }
}
