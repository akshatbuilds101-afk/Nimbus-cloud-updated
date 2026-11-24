/* Lightweight same-site transitions; does not alter app.js or Supabase requests. */
(() => {
  const ready = () => {
    document.body.classList.add('nv-ready');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || link.target === '_blank') return;
      let destination;
      try { destination = new URL(link.href, location.href); } catch { return; }
      if (destination.origin !== location.origin || !/\.html$/i.test(destination.pathname) || (destination.pathname === location.pathname && destination.search === location.search)) return;
      if (reduce) return;
      event.preventDefault();
      document.body.classList.add('nv-leaving');
      setTimeout(() => { location.href = destination.href; }, 155);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
  else ready();
})();
