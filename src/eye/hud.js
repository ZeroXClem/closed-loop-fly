/** Eye HUD: equirectangular dot map per eye (port of the eye part of AbijahKaj's ui/hud.ts). */
export class EyeHud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }
  /** values: luminance (0..1) or a signed map when `signed` (drawn red/blue). */
  draw(ommL, valL, ommR, valR, { signed = false, label = 'luminance' } = {}) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9aa3ad';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`eyes (${label})  L ${ommL.count}  R ${ommR.count}`, 6, 12);
    this.drawEye(ommL, valL, signed);
    this.drawEye(ommR, valR, signed);
  }
  drawEye(omm, val, signed) {
    const { ctx, canvas } = this;
    const top = 18,
      h = canvas.height - top - 4,
      w = canvas.width - 8;
    const azSpan = (340 * Math.PI) / 180,
      elTop = (75 * Math.PI) / 180,
      elSpan = (135 * Math.PI) / 180;
    for (let i = 0; i < omm.count; i++) {
      const x = 4 + ((omm.az[i] + azSpan / 2) / azSpan) * w;
      const y = top + ((elTop - omm.el[i]) / elSpan) * h;
      if (!signed) {
        const v = Math.sqrt(Math.max(0, Math.min(1, val[i])));
        const g = Math.round(40 + v * 215);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
      } else {
        const v = Math.max(-1, Math.min(1, val[i] * 3));
        ctx.fillStyle = v >= 0 ? `rgba(255,90,70,${0.15 + v * 0.85})` : `rgba(70,140,255,${0.15 - v * 0.85})`;
      }
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }
}
