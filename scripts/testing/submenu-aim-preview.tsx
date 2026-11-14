import { createRoot } from "react-dom/client";
import { SidebarPopoverMenu, type SidebarMenuItem } from "../../src/components/SidebarPopoverMenu";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

const noop = () => {};
const items: SidebarMenuItem[] = [
  { key: "usage", label: "Usage", onSelect: noop },
  { key: "support", label: "Support", onSelect: noop, submenu: [
    { key: "help", label: "Help center", onSelect: noop },
    { key: "keys", label: "Keyboard shortcuts", onSelect: noop },
    { key: "feedback", label: "Send feedback", onSelect: noop },
    { key: "export", label: "Export usage log", onSelect: noop },
    { key: "about", label: "About", onSelect: noop },
  ] },
  { key: "settings", label: "Settings", onSelect: noop },
  { key: "signout", label: "Sign out", onSelect: noop },
];

applySkin(readSkin());
createRoot(document.getElementById("root")!).render(
  <div style={{ position: "fixed", left: 24, bottom: 24 }}>
    <SidebarPopoverMenu items={items} ariaLabel="Account" renderTrigger={() => <span>Account</span>} />
  </div>,
);
