import { Game } from './engine/Game';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');
  if (!canvas || !uiRoot) {
    throw new Error('Missing #game-canvas or #ui-root');
  }

  const params = new URLSearchParams(window.location.search);
  const seedParam = params.get('seed'); // null -> show Main Menu; ?seed=... -> jump directly into world
  const game = new Game(canvas, uiRoot, seedParam);

  window.addEventListener('beforeunload', () => {
    void game.saveNow();
    game.dispose();
  });
}

bootstrap();
