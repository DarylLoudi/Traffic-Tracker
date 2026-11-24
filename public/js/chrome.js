// The language button, shared by the landing page and the dashboard.
import { getLang, setLang, t } from './i18n.js';

export function initChrome({ onLang = () => {} } = {}) {
  const langBtn = document.getElementById('lang-btn');
  const paint = () => {
    langBtn.textContent = getLang() === 'id' ? 'EN' : 'ID';
    langBtn.setAttribute('aria-label', t('langBtn'));
    langBtn.setAttribute('lang', getLang() === 'id' ? 'en' : 'id');
  };
  langBtn.addEventListener('click', () => {
    setLang(getLang() === 'id' ? 'en' : 'id');
    paint();
    onLang(getLang());
  });
  paint();
  return paint;
}
