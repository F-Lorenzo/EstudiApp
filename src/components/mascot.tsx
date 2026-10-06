"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { gsap } from "gsap";

/** Original BrandBook artwork. SVG clipping keeps the character intact while
 * the head and pupil groups move independently. No raster redraw or 3D model. */
export function Mascot({
  stageRef,
}: {
  stageRef: RefObject<HTMLElement | null>;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const head = useRef<SVGGElement>(null);
  const leftPupil = useRef<SVGGElement>(null);
  const rightPupil = useRef<SVGGElement>(null);
  const id = useId().replace(/:/g, "");
  const headShape =
    "M324 393C315 251 401 125 550 108C714 84 849 166 878 343L887 364Q909 360 911 387L897 401C918 526 839 608 746 641Q634 684 522 639C462 628 412 604 380 561Q353 558 339 538Q328 516 346 495L341 473Q327 441 324 393Z";

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !svg.current || !head.current) return;
    const media = gsap.matchMedia();
    media.add(
      "(prefers-reduced-motion: no-preference) and (pointer: fine)",
      () => {
        gsap.set(head.current, { svgOrigin: "628 641" });
        const rotate = gsap.quickTo(head.current, "rotation", {
          duration: 0.85,
          ease: "power3.out",
        });
        const headX = gsap.quickTo(head.current, "x", {
          duration: 0.8,
          ease: "power3.out",
        });
        const headY = gsap.quickTo(head.current, "y", {
          duration: 0.8,
          ease: "power3.out",
        });
        const eyes = [leftPupil.current, rightPupil.current].map((el) => ({
          x: gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" }),
          y: gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" }),
        }));
        const move = (event: PointerEvent) => {
          if (event.pointerType === "touch" || !svg.current) return;
          const rect = svg.current.getBoundingClientRect();
          const x = gsap.utils.clamp(
            -1,
            1,
            (event.clientX - (rect.left + rect.width * 0.51)) /
              (rect.width * 0.8),
          );
          const y = gsap.utils.clamp(
            -1,
            1,
            (event.clientY - (rect.top + rect.height * 0.35)) /
              (rect.height * 0.7),
          );
          rotate(x * 2.8);
          headX(x * 4);
          headY(y * 3);
          eyes.forEach((eye) => {
            eye.x(x * 15);
            eye.y(y * 12);
          });
        };
        const reset = () => {
          rotate(0);
          headX(0);
          headY(0);
          eyes.forEach((eye) => {
            eye.x(0);
            eye.y(0);
          });
        };
        stage.addEventListener("pointermove", move, { passive: true });
        stage.addEventListener("pointerleave", reset);
        return () => {
          stage.removeEventListener("pointermove", move);
          stage.removeEventListener("pointerleave", reset);
        };
      },
    );
    return () => media.revert();
  }, [stageRef]);

  return (
    <svg
      ref={svg}
      className="mascot-svg"
      viewBox="0 0 1254 1254"
      role="img"
      aria-labelledby={`${id}-title`}
    >
      <title id={`${id}-title`}>
        La mascota de EstudiApp: un pulpo naranja con anteojos, chaleco
        académico y útiles para aprender.
      </title>
      <defs>
        <clipPath id={`${id}-head`}>
          <path d={headShape} />
        </clipPath>
        <mask id={`${id}-body`}>
          <rect width="1254" height="1254" fill="white" />
          <path d={headShape} fill="black" />
        </mask>
        <clipPath id={`${id}-left-eye`}>
          <ellipse
            cx="536"
            cy="474"
            rx="68"
            ry="70"
            transform="rotate(-13 536 474)"
          />
        </clipPath>
        <clipPath id={`${id}-right-eye`}>
          <ellipse
            cx="768"
            cy="430"
            rx="61"
            ry="70"
            transform="rotate(-13 768 430)"
          />
        </clipPath>
      </defs>
      <image
        href="/brand/mascot-supplies.png"
        width="1254"
        height="1254"
        mask={`url(#${id}-body)`}
      />
      <g ref={head} className="mascot-head">
        <image
          href="/brand/mascot-supplies.png"
          width="1254"
          height="1254"
          clipPath={`url(#${id}-head)`}
        />
        <g clipPath={`url(#${id}-left-eye)`}>
          <ellipse cx="536" cy="474" rx="75" ry="76" fill="#fffefb" />
          <g ref={leftPupil} className="mascot-pupil">
            <ellipse
              cx="548"
              cy="474"
              rx="39"
              ry="51"
              fill="#543323"
              transform="rotate(-12 548 474)"
            />
            <ellipse
              cx="545"
              cy="474"
              rx="24"
              ry="36"
              fill="#221d18"
              transform="rotate(-12 545 474)"
            />
            <ellipse cx="529" cy="451" rx="10" ry="12" fill="#fff" />
            <circle cx="561" cy="497" r="4" fill="#fff" opacity=".55" />
          </g>
        </g>
        <g clipPath={`url(#${id}-right-eye)`}>
          <ellipse cx="768" cy="430" rx="69" ry="79" fill="#fffefb" />
          <g ref={rightPupil} className="mascot-pupil">
            <ellipse
              cx="747"
              cy="442"
              rx="35"
              ry="50"
              fill="#543323"
              transform="rotate(-14 747 442)"
            />
            <ellipse
              cx="742"
              cy="440"
              rx="23"
              ry="35"
              fill="#221d18"
              transform="rotate(-14 742 440)"
            />
            <ellipse cx="726" cy="416" rx="9" ry="12" fill="#fff" />
            <circle cx="759" cy="465" r="4" fill="#fff" opacity=".55" />
          </g>
        </g>
      </g>
    </svg>
  );
}
