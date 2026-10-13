async page => {
  await page.context().addInitScript(() => {
    const SIZE = 36;
    const TIP_X = (5.5 / 24) * SIZE;
    const TIP_Y = (3.2 / 24) * SIZE;
    const GLOW = Math.round(SIZE * (5 / 3));
    const RIPPLE = Math.round(SIZE * 1.25);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const centerOf = el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const CSS = `
      #__pw-cursor { position: fixed; z-index: 2147483647; pointer-events: none;
        left: 0; top: 0; will-change: transform; transform-origin: ${TIP_X}px ${TIP_Y}px;
        filter: drop-shadow(0 ${SIZE / 12}px ${SIZE / 6}px rgba(0,0,0,.35));
        transition: transform .45s cubic-bezier(.25,.7,.3,1); }
      #__pw-cursor svg { display: block; }
      #__pw-cursor.pressed { transition: transform .12s ease-out; }
      #__pw-glow { position: fixed; z-index: 2147483646; pointer-events: none;
        left: 0; top: 0; width: ${GLOW}px; height: ${GLOW}px; border-radius: 50%;
        border: 2px solid rgba(59,130,246,.95); background: rgba(59,130,246,.14);
        opacity: 0; transform: translate(-200px,-200px) scale(1);
        transition: opacity .18s ease-out, transform .25s ease-out; }
      #__pw-ripple { position: fixed; z-index: 2147483646; pointer-events: none;
        left: 0; top: 0; width: ${RIPPLE}px; height: ${RIPPLE}px; border-radius: 50%;
        border: 3px solid rgba(59,130,246,.95);
        opacity: 0; transform: translate(-200px,-200px) scale(.3); }
      #__pw-ripple.go { transition: transform .5s cubic-bezier(.2,.6,.3,1), opacity .5s ease-out; }
    `;

    const ARROW = `
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5 3.2 L19.6 12.1 L13.2 13.7 L10 20.4 Z"
              fill="#0b0b0b" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;

    let cursor, glow, ripple;
    let moveCount = 0;

    function ensure() {
      const existing = document.getElementById('__pw-cursor');
      if (existing && existing.isConnected) {
        cursor = existing;
        glow = document.getElementById('__pw-glow');
        ripple = document.getElementById('__pw-ripple');
        return;
      }
      const style = document.createElement('style');
      style.textContent = CSS;
      document.documentElement.appendChild(style);
      cursor = document.createElement('div');
      cursor.id = '__pw-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      cursor.innerHTML = ARROW;
      glow = document.createElement('div');
      glow.id = '__pw-glow';
      ripple = document.createElement('div');
      ripple.id = '__pw-ripple';
      document.documentElement.append(cursor, glow, ripple);
      cursor.style.transition = 'none';
      cursor.style.transform = `translate(${innerWidth + 60}px, ${innerHeight + 60}px)`;
      void cursor.offsetWidth;
      cursor.style.transition = '';
    }

    const place = (x, y, scale) =>
      `translate(${x - TIP_X}px, ${y - TIP_Y}px) scale(${scale})`;

    window.__pwCursor = {
      move(x, y) {
        ensure();
        moveCount += 1;
        cursor.classList.remove('pressed');
        cursor.style.transform = place(x, y, 1);
      },
      hover(x, y) {
        ensure();
        glow.style.transition = 'none';
        glow.style.transform = `translate(${x - GLOW / 2}px, ${y - GLOW / 2}px) scale(1)`;
        void glow.offsetWidth;
        glow.style.transition = '';
        glow.style.opacity = '1';
      },
      unhover() {
        if (glow) glow.style.opacity = '0';
      },
      click(x, y) {
        ensure();
        ripple.classList.remove('go');
        ripple.style.transform = `translate(${x - RIPPLE / 2}px, ${y - RIPPLE / 2}px) scale(.3)`;
        ripple.style.opacity = '0.95';
        void ripple.offsetWidth;
        ripple.classList.add('go');
        ripple.style.transform = `translate(${x - RIPPLE / 2}px, ${y - RIPPLE / 2}px) scale(1.7)`;
        ripple.style.opacity = '0';
        cursor.classList.add('pressed');
        cursor.style.transform = place(x, y, 0.82);
        const movesAtPress = moveCount;
        setTimeout(() => {
          if (moveCount !== movesAtPress) return;
          cursor.classList.remove('pressed');
          cursor.style.transform = place(x, y, 1);
        }, 130);
      },
      async tap(el) {
        const { x, y } = centerOf(el);
        this.move(x, y);
        await sleep(450);
        this.hover(x, y);
        await sleep(250);
        this.click(x, y);
        this.unhover();
      },
      async point(el) {
        const { x, y } = centerOf(el);
        this.move(x, y);
        await sleep(450);
      },
      aside(el) {
        const { x, y } = centerOf(el);
        this.move(x + 120, y + 70);
      },
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensure);
    } else {
      ensure();
    }
  });
}
