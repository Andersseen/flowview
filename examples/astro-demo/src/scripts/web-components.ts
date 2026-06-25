import { defineCustomElement as defineAndNavbar } from "@andersseen/web-components/components/and-navbar.js";
import { defineCustomElement as defineAndBadge } from "@andersseen/web-components/components/and-badge.js";
import { defineCustomElement as defineAndButton } from "@andersseen/web-components/components/and-button.js";
import { defineCustomElement as defineAndCard } from "@andersseen/web-components/components/and-card.js";
import { defineCustomElement as defineAndCardContent } from "@andersseen/web-components/components/and-card-content.js";
import { defineCustomElement as defineAndCardHeader } from "@andersseen/web-components/components/and-card-header.js";
import { defineCustomElement as defineAndCardTitle } from "@andersseen/web-components/components/and-card-title.js";
import { defineCustomElement as defineAndIcon } from "@andersseen/web-components/components/and-icon.js";
import { registerIcons, GITHUB, MOON, SUN } from "@andersseen/icon";

defineAndNavbar();
defineAndBadge();
defineAndButton();
defineAndCard();
defineAndCardContent();
defineAndCardHeader();
defineAndCardTitle();
defineAndIcon();

registerIcons({ github: GITHUB, moon: MOON, sun: SUN });
