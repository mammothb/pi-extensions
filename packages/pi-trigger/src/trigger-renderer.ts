import {
  type ParsedSkillBlock,
  SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Container, Spacer } from "@earendil-works/pi-tui";

type TriggerDetail = {
  namespace: "skill" | "prompt";
  name: string;
  location: string;
  content: string;
};

type TriggerMessageDetails = {
  triggers: TriggerDetail[];
};

// Build a ParsedSkillBlock suitable for SkillInvocationMessageComponent.
function toSkillBlock(t: TriggerDetail): ParsedSkillBlock {
  return {
    name: `${t.namespace}:${t.name}`,
    location: t.location,
    content: t.content,
    userMessage: undefined,
  };
}

// Render a batch of trigger messages (one or more skill/prompt invocations)
// as collapsible rows in the TUI.
export function renderTriggerBatch(
  message: { details?: unknown },
  options: { expanded: boolean },
  _theme: unknown,
): Component | undefined {
  const details = message.details as TriggerMessageDetails | undefined;
  if (!details?.triggers?.length) {
    return undefined;
  }

  if (details.triggers.length === 1 && details.triggers[0]) {
    return renderTrigger(details.triggers[0], options.expanded);
  }

  const container = new Container();
  details.triggers.forEach((trigger, index) => {
    if (index > 0) {
      container.addChild(new Spacer(1));
    }
    container.addChild(renderTrigger(trigger, options.expanded));
  });
  return container;
}

// Render a single trigger using SkillInvocationMessageComponent.
function renderTrigger(trigger: TriggerDetail, expanded: boolean): Component {
  const component = new SkillInvocationMessageComponent(toSkillBlock(trigger));
  component.setExpanded(expanded);
  return component;
}
