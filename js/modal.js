// modal.js — modal open/close with iOS scroll-lock fix

export class ModalController {
  constructor() {
    this._scrollY = 0;
  }

  open(idOrEl) {
    const el = this._resolve(idOrEl);
    if (!el) return;

    // iOS: lock body scroll by fixing position
    this._scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${this._scrollY}px`;
    document.body.style.width = '100%';

    el.classList.add('active');
    el.removeAttribute('aria-hidden');

    // Focus first focusable element for a11y
    const focusable = el.querySelector('button, input, textarea, [tabindex]');
    if (focusable) setTimeout(() => focusable.focus(), 300);
  }

  close(idOrEl) {
    const el = this._resolve(idOrEl);
    if (!el || !el.classList.contains('active')) return;

    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');

    // Restore body scroll only when no other modals remain open
    if (!document.querySelector('.modal-overlay.active, .success-overlay.active')) {
      this._restoreScroll();
    }
  }

  closeAll() {
    document.querySelectorAll('.modal-overlay.active').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-hidden', 'true');
    });
    this._restoreScroll();
  }

  _resolve(idOrEl) {
    return typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  }

  _restoreScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, this._scrollY);
  }
}
