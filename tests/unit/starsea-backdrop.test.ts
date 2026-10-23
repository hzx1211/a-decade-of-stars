// @vitest-environment jsdom
import React from "react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {cleanup, render} from "@testing-library/react";
import {MotionScope} from "../../components/motion";
import {StarseaBackdrop} from "../../components/starsea-backdrop";

const gradient = () => ({addColorStop: vi.fn()});
const context = {
  clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), createRadialGradient: vi.fn(gradient), createLinearGradient: vi.fn(gradient),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), bezierCurveTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
};

afterEach(() => {cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe("visitor starsea backdrop", () => {
  it("keeps the animated CSS sea while skipping private frame requests", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const backdrop=React.createElement(StarseaBackdrop, {privateMediaEnabled: false} as React.ComponentProps<typeof StarseaBackdrop>);
    const {container} = render(React.createElement(MotionScope, {enabled: true} as React.ComponentProps<typeof MotionScope>, backdrop));
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector(".starsea-blue-horizon")).toBeTruthy();
    expect(container.querySelector(".starsea-light-current")).toBeTruthy();
    expect(container.querySelector("canvas.starsea-audience")).toBeTruthy();
    expect(container.querySelector(".starsea-frame-layer")?.getAttribute("style")).toBeNull();
  });

  it("continues loading private frames for the owner view", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => ({version: 1, frames: []})});
    vi.stubGlobal("fetch", fetcher);

    const backdrop=React.createElement(StarseaBackdrop, {privateMediaEnabled: true} as React.ComponentProps<typeof StarseaBackdrop>);
    render(React.createElement(MotionScope, {enabled: true} as React.ComponentProps<typeof MotionScope>, backdrop));
    expect(fetcher).toHaveBeenCalledWith("/api/starsea-frames", expect.objectContaining({cache: "no-store", credentials: "same-origin"}));
  });
});
