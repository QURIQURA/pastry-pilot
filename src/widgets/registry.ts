import type { WidgetDef } from "./types";
import { todayWidget } from "./today.widget";
import { quickCreateWidget } from "./quick-create.widget";
import { abbreviationLegendWidget } from "./abbreviation-legend.widget";
import { orderCodeGuideWidget } from "./order-code-guide.widget";

export const widgets: WidgetDef[] = [todayWidget, quickCreateWidget, orderCodeGuideWidget, abbreviationLegendWidget];
