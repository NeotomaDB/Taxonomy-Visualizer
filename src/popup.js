export function createPopup(id) {
  let popup = document.getElementById(id);
  if (!popup) {
    popup = document.createElement('div');
    popup.id = id;
    popup.style.cssText = 'position:absolute; display:none; background:#fff; border:1px solid #ccc; padding:12px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); z-index:9999; max-width:300px;';
    document.body.appendChild(popup);
  }

  function showAt(x, y, title, description) {
    popup.innerHTML = `<div style="font-weight:600; font-size:16px; margin-bottom:8px;">${title}</div>`;
    if (description) {
      popup.innerHTML += `<div style="font-size:14px; color:#666;">${description}</div>`;
    }
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    popup.style.display = 'block';

    // Add click-outside-to-close functionality
    setTimeout(() => {
      const closeOnClickOutside = (event) => {
        if (!popup.contains(event.target)) {
          popup.style.display = 'none';
          document.removeEventListener('click', closeOnClickOutside);
        }
      };
      document.addEventListener('click', closeOnClickOutside);
    }, 0);
  }

  function hide() {
    popup.style.display = 'none';
  }

  return { showAt, hide };
}
