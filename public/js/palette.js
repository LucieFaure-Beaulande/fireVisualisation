/* CSS is the source of truth for interface and data palette tokens. */
window.FirePalette = {
  token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  },
  sequential(classes = 7) {
    const name = this.token("--data-sequential");
    return d3[`scheme${name}`]?.[classes] ?? d3.schemeOranges[classes];
  }
};
