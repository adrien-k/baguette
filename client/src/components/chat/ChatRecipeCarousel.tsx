import { CircleCheck, GitPullRequest, MessageSquare, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BUILTIN_CHAT_RECIPE_IDS } from '@baguette/shared/session-chat-recipes.js';
import ChatQuickActionButton, { CHAT_ACTION_BUTTON_CLASS } from './ChatQuickActionButton.tsx';
import type { ChatRecipe } from './ChatRecipesSection.tsx';

const BUILTIN_RECIPE_ICONS: Record<string, LucideIcon> = {
  [BUILTIN_CHAT_RECIPE_IDS.GIT_SYNC]: GitPullRequest,
  [BUILTIN_CHAT_RECIPE_IDS.CHECK_CI]: CircleCheck,
  [BUILTIN_CHAT_RECIPE_IDS.CHECK_COMMENTS]: MessageSquare,
};

const BUILTIN_RECIPE_BUTTON_CLASS = `${CHAT_ACTION_BUTTON_CLASS} shrink-0 snap-start`;
const CUSTOM_RECIPE_BUTTON_CLASS = `${BUILTIN_RECIPE_BUTTON_CLASS} border-dashed bg-inset/40 hover:bg-inset/70`;

type ChatRecipeCarouselProps = {
  recipes: ChatRecipe[];
  disabled?: boolean;
  onSelect: (prompt: string) => void;
};

/** Horizontal scroll row of recipe chips (modal / narrow layouts). */
export default function ChatRecipeCarousel({
  recipes,
  disabled = false,
  onSelect,
}: ChatRecipeCarouselProps) {
  if (!recipes.length) return null;

  return (
    <div
      data-testid="chat-recipe-carousel"
      className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 -mx-0.5 px-0.5 snap-x snap-mandatory"
    >
      {recipes.map((recipe) => {
        const Icon = recipe.builtin ? BUILTIN_RECIPE_ICONS[recipe.id] : Sparkles;
        const tooltip = recipe.description || recipe.label;
        const className = recipe.builtin ? BUILTIN_RECIPE_BUTTON_CLASS : CUSTOM_RECIPE_BUTTON_CLASS;
        return (
          <ChatQuickActionButton
            key={recipe.id}
            icon={Icon}
            label={recipe.label}
            tooltip={tooltip}
            disabled={disabled}
            onClick={() => onSelect(recipe.prompt)}
            className={className}
            data-testid={
              recipe.builtin
                ? `chat-recipe-builtin-${recipe.id}`
                : `chat-recipe-custom-${recipe.id}`
            }
          />
        );
      })}
    </div>
  );
}
