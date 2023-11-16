import TwoUp from "./two-up";
export * from "./two-up";
export { default } from "./two-up";
customElements.get("two-up") || customElements.define("two-up", TwoUp);
