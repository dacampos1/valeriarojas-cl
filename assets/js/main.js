(() => {
  const triggers = [...document.querySelectorAll("[data-lightbox-src]")];
  const lightbox = document.querySelector("#lightbox");
  if (!triggers.length || !lightbox) return;

  const image = lightbox.querySelector("figure img");
  const caption = lightbox.querySelector("figcaption");
  let index = 0;
  let previousFocus;

  const show = (nextIndex) => {
    index = (nextIndex + triggers.length) % triggers.length;
    image.src = triggers[index].dataset.lightboxSrc;
    image.alt = triggers[index].dataset.lightboxAlt || "";
    caption.textContent = image.alt;
  };
  const open = (nextIndex) => {
    previousFocus = document.activeElement;
    show(nextIndex);
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    lightbox.querySelector(".lightbox-close").focus();
  };
  const close = () => {
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    previousFocus?.focus();
  };

  triggers.forEach((trigger, triggerIndex) => trigger.addEventListener("click", () => open(triggerIndex)));
  lightbox.querySelector(".lightbox-close").addEventListener("click", close);
  lightbox.querySelector(".lightbox-prev").addEventListener("click", () => show(index - 1));
  lightbox.querySelector(".lightbox-next").addEventListener("click", () => show(index + 1));
  lightbox.addEventListener("click", (event) => { if (event.target === lightbox) close(); });
  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") show(index - 1);
    if (event.key === "ArrowRight") show(index + 1);
  });
})();
