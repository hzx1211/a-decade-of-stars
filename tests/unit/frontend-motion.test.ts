// @vitest-environment jsdom
import React, {useState} from "react";
import {afterEach, describe, expect, it} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {motion} from "motion/react";
import {MotionList, MotionPresence} from "../../components/motion";

afterEach(cleanup);

describe("retained exits do not retain actionable stale controls", () => {
  it("hides an exiting bulk action from keyboard and accessibility while retaining the visible exit", async () => {
    function Harness() {
      const [selected, setSelected] = useState(true);
      return React.createElement(React.Fragment, null,
        React.createElement("button", {onClick: () => setSelected(false)}, "取消选择"),
        React.createElement(MotionPresence, {show: selected} as React.ComponentProps<typeof MotionPresence>, React.createElement("button", {"data-testid": "bulk-delete"}, "删除选中")),
      );
    }
    render(React.createElement(Harness));
    const deleting = screen.getByTestId("bulk-delete");
    fireEvent.click(screen.getByRole("button", {name: "取消选择"}));
    expect(deleting.isConnected).toBe(true);
    expect(deleting.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("button", {name: "删除选中"})).toBeNull();
    await waitFor(() => expect(deleting.isConnected).toBe(false));
  });

  it("keeps a filtered item inert until its exit finishes and preserves the retained item's DOM identity", async () => {
    function Harness() {
      const [filtered, setFiltered] = useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement("button", {onClick: () => setFiltered(true)}, "筛选"),
        React.createElement(MotionList, {} as React.ComponentProps<typeof MotionList>, ["保留", ...(filtered ? [] : ["移除"])].map(name =>
          React.createElement(motion.button, {key: name, exit: {opacity: 0}, transition: {duration: .12}}, name))),
      );
    }
    render(React.createElement(Harness));
    const staying = screen.getByRole("button", {name: "保留"}), leaving = screen.getByRole("button", {name: "移除"});
    fireEvent.click(screen.getByRole("button", {name: "筛选"}));
    expect(leaving.isConnected).toBe(true);
    expect(leaving.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", {name: "移除"})).toBeNull();
    expect(screen.getByRole("button", {name: "保留"})).toBe(staying);
    await waitFor(() => expect(leaving.isConnected).toBe(false));
  });
});
