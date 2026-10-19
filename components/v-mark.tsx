import { useId } from "react";
import {vMarkSilhouette} from "@/lib/v-mark-geometry";

// Traced from the owner's supplied tour reference for this private fan archive.
// The silhouette is deliberately split at the foot, with flat, extended serifs.

export function VMark({ size = 32, className }: { size?: number | string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `tour-v-clip-${id}`;
  const blue = `tour-v-blue-${id}`;

  return (
    <svg width={size} height={size} viewBox="130 270 880 750" fill="none" className={`v-mark ${className ?? ""}`.trim()} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}><path d={vMarkSilhouette} /></clipPath>
        <linearGradient id={blue} x1="300" y1="290" x2="780" y2="1000" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0749fa" /><stop offset=".54" stopColor="#0642e5" /><stop offset="1" stopColor="#0637d7" />
        </linearGradient>
      </defs>
      <path d={vMarkSilhouette} fill={`url(#${blue})`} />
      <g clipPath={`url(#${clip})`} stroke="#2ca9ff" strokeLinecap="round" strokeLinejoin="round">
        <g opacity=".77" strokeWidth="9">
          <path d="M258 422C327 450 366 426 417 396S503 333 565 334M287 442C344 442 339 420 307 477S297 494 333 449" />
          <path d="M370 467C304 530 346 526 362 506C373 492 408 468 395 505C374 565 423 521 449 512" />
          <path d="M355 585C399 576 445 573 463 559M400 573C367 599 342 636 363 642C379 647 444 572 418 619C386 676 425 673 448 640C462 620 471 618 454 653C443 676 472 687 500 654" />
          <path d="M660 342C671 312 640 306 624 323C606 349 629 352 646 363L615 384" />
          <path d="M689 379C730 321 772 323 768 427M768 427C761 325 806 309 843 362C873 402 877 439 896 449M794 427C789 363 812 362 825 427" />
          <path d="M708 500C668 444 727 462 716 491C704 514 754 537 754 506C754 491 738 487 725 492C778 470 754 451 727 470M714 552C751 567 735 589 715 581" />
          <path d="M629 618C690 619 728 582 768 591M669 610C636 641 608 686 631 690C652 695 716 623 690 660C651 715 675 709 699 680C715 660 724 657 708 689C698 710 717 711 743 684" />
          <path d="M422 842C474 854 503 871 544 854M484 849C465 886 426 929 438 949C446 962 503 922 498 938C483 977 518 956 548 927" />
          <path d="M568 909C550 943 545 969 561 948C588 912 601 900 590 935C568 992 609 944 658 919C673 911 656 939 650 952C643 968 678 942 697 916C711 896 713 926 701 944C687 964 724 944 733 928" />
        </g>
        <g opacity=".53" strokeWidth="3">
          <path d="M288 591C451 645 626 560 801 567M376 757C491 767 600 747 734 715M357 787C472 816 615 780 744 738" />
          <path d="M615 810C586 753 679 757 705 781M645 807C641 777 652 770 681 767M670 773C691 744 726 728 744 749" />
          <path d="M355 976C473 1013 647 984 760 959M736 920C749 966 778 979 865 975" />
        </g>
        <g opacity=".65" strokeWidth="2" strokeDasharray="1 9">
          <path d="M299 400C320 423 359 415 399 399M342 632C399 618 431 630 475 651M396 780C498 796 612 774 723 740M400 823C431 843 470 830 501 813M588 962C668 985 738 1007 828 992" />
        </g>
      </g>
      <g clipPath={`url(#${clip})`} fill="#44c3ff">
        <path d="M349 355C349 367 343 372 333 373C344 375 349 380 350 391C352 380 358 376 369 375C357 374 353 367 349 355Z" />
        <path d="M405 351C405 358 402 363 395 365C402 366 405 370 406 377C407 369 411 366 417 364C410 363 407 359 405 351Z" />
        <path d="M673 313C673 320 670 324 663 326C670 327 673 332 674 339C676 331 679 328 686 326C678 325 675 321 673 313Z" />
        <path d="M785 464C785 470 782 474 776 476C783 477 785 481 786 487C787 480 791 477 797 476C790 475 787 471 785 464Z" />
        <path d="M438 807L442 814L450 814L444 821L446 830L438 826L430 831L431 822L424 817L433 815Z" />
        <path d="M490 781L493 789L503 791L495 796L495 805L488 799L480 802L483 793L477 787L487 788Z" />
        <path d="M334 922C334 948 325 956 296 962C324 965 334 977 335 1004C339 977 349 967 376 963C349 958 339 947 334 922Z" />
        <circle cx="419" cy="369" r="2.5" /><circle cx="683" cy="330" r="2" /><circle cx="784" cy="987" r="2" />
      </g>
    </svg>
  );
}
