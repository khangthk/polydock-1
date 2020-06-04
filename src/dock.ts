import config from "./config"
import { DockItem } from "./dock-item"
import Gtk from "./types/Gtk-3.0"
import Wnck from "./types/Wnck-3.0"

export class Dock {
  items = new Map<number, DockItem>()
  toolbar = new Gtk.Toolbar()
  screen: Wnck.Screen
  show = false

  constructor(public horizontal = true) {
    const screen = Wnck.Screen.get_default()
    if (!screen) throw new Error("No screens detected!")
    this.screen = screen
    this.toolbar.set_name("dock")
    this.toolbar.get_style_context().add_class("dock")
    this.toolbar.set_show_arrow(false)
    this.toolbar.set_orientation(
      horizontal ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL
    )
    this.toolbar.show_all()
    this.screen.force_update()
    this.update("constructor")
    screen.connect("active-workspace-changed", () =>
      this.update("active-workspace-changed")
    )
    screen.connect("active-window-changed", (_screen, prev) => {
      // HACK: refcount seems wrong for closed windows that were active before
      if (prev && !prev.get_class_group()) prev.ref()
      this.update("active-window-changed")
    })
    screen.connect("window-opened", () => this.update("window-opened"))
    screen.connect("window-closed", () => this.update("window-closed"))
  }

  update(event: string) {
    log(`[update] + ${event}`)
    // this.screen.force_update()
    const windows = this.screen.get_windows()
    if (!windows) return log("No Windows!")

    // Remove closed windows
    const xids = new Set<number>(windows.map((x) => x.get_xid()))
    for (const [xid, item] of this.items.entries()) {
      if (!xids.has(xid)) {
        log(`- ${imports.system.refcount(item.window)} ${item.name}`)
        this.items.delete(xid)
        this.toolbar.remove(item.button)
      }
    }

    // Add opened windows
    windows.forEach((window) => {
      const xid = window.get_xid()
      if (!this.items.has(xid)) {
        window.connect("geometry-changed", () => this.toolbar.check_resize())
        window.connect("workspace-changed", () =>
          this.update("workspace-changed")
        )
        const item = new DockItem(window, this.horizontal)
        log(`+ ${imports.system.refcount(item.window)} ${item.name}`)
        this.toolbar.add(item.button)
        this.items.set(xid, item)
      }
    })

    // Update window state
    const workspace = this.screen.get_active_workspace()
    const groups = new Map<string, DockItem>()
    const active = this.screen.get_active_window()?.get_xid() ?? undefined
    let buttonCount = 0
    for (const item of this.items.values()) {
      item.setClass("active", active == item.window.get_xid())
      const groupKey = item.getGroupKey()
      let visible = true
      if (
        config.settings.behavior.activeWorkspaceOnly &&
        !item.window.is_on_workspace(workspace)
      )
        visible = false
      if (!config.settings.behavior.showHidden && item.isHidden())
        visible = false
      if (!config.settings.behavior.showVisible && !item.isHidden())
        visible = false

      if (groupKey && groups.has(groupKey)) {
        visible = false
        groups.get(groupKey)?.addMenuItem(item)
        if (active == item.window.get_xid())
          groups.get(groupKey)?.setActive(true)
      }

      if (visible && groupKey && !groups.has(groupKey)) {
        groups.set(groupKey, item)
        item.addMenuItem(item, true)
      }

      if (visible) {
        item.button.show_all()
        buttonCount++
      } else item.button.hide()
    }

    log(`[update] - ${event} [${buttonCount}]`)
    if (buttonCount) {
      log("[toobar] show")
      this.show = true
    } else {
      log("[toobar] hide")
      this.show = false
    }
    this.toolbar.check_resize()
  }
}
