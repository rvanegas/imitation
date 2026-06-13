import React, { useState, useEffect, useRef, useReducer } from 'react';
import { ActivityIndicator, View, Linking } from 'react-native';
import { ImitationClient, ServerMessage, Label } from './src/ws';
import { getToken, saveToken, clearToken } from './src/store';
import { reduce, initialState } from './src/gameState';
import LoginScreen from './src/screens/LoginScreen';
import GameScreen from './src/screens/GameScreen';

type Screen = 'loading' | 'login' | 'game';

function parseInviteToken(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^imitation:\/\/join\/(\d+)$/);
  return match?.[1] ?? null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [client, setClient] = useState<ImitationClient | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [state, dispatch] = useReducer(reduce, initialState);

  // Refs so URL-event callbacks always see the latest screen and client.
  const screenRef = useRef<Screen>('loading');
  const clientRef = useRef<ImitationClient | null>(null);
  screenRef.current = screen;
  clientRef.current = client;

  useEffect(() => {
    // While the app is already running, handle incoming deep links.
    const sub = Linking.addEventListener('url', ({ url }) => {
      const token = parseInviteToken(url);
      if (!token) return;
      if (screenRef.current === 'game' && clientRef.current) {
        clientRef.current.cmd(`/start ${token}`);
      }
    });

    // Cold-start: check if the app was opened from a deep link.
    Linking.getInitialURL().then(url => {
      tryAutoLogin(parseInviteToken(url) ?? undefined);
    });

    return () => sub.remove();
  }, []);

  function makeClient(onMsg: (msg: ServerMessage) => void): ImitationClient {
    return new ImitationClient(onMsg, () => {
      setScreen('loading');
      setTimeout(tryAutoLogin, 2000);
    });
  }

  async function tryAutoLogin(inviteToken?: string) {
    const storedToken = await getToken();

    if (!storedToken) {
      if (inviteToken) {
        // New user opening via deep link: bootstrap directly into the game.
        let authed = false;
        const c = makeClient((msg) => {
          if (msg.type === 'error' && !authed) {
            c.disconnect();
            setScreen('login');
            return;
          }
          if (msg.type === 'ready') authed = true;
          handleServerMessage(msg, c);
        });
        c.connect(() => c.bootstrap(inviteToken));
      } else {
        setScreen('login');
      }
      return;
    }

    let authed = false;
    const c = makeClient((msg) => {
      if (msg.type === 'error' && !authed) {
        c.disconnect();
        clearToken();
        setScreen('login');
        return;
      }
      if (msg.type === 'ready') {
        authed = true;
        if (inviteToken) c.cmd(`/start ${inviteToken}`);
      }
      handleServerMessage(msg, c);
    });
    c.connect(() => c.login(storedToken));
  }

  function handleServerMessage(msg: ServerMessage, c: ImitationClient) {
    if (msg.type === 'ready') {
      if (msg.token) saveToken(msg.token);
      setPlayerName(msg.name);
      setClient(c);
      setScreen('game');
    } else if (msg.type === 'nameUpdate') {
      setPlayerName(msg.name);
    } else {
      dispatch({ kind: 'server', msg });
    }
  }

  function handleAuthenticated(c: ImitationClient, name: string) {
    c.setMessageHandler((msg) => handleServerMessage(msg, c));
    setClient(c);
    setPlayerName(name);
    dispatch({ kind: 'reset' });
    setScreen('game');
  }

  if (screen === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (screen === 'login') {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <GameScreen
      state={state}
      name={playerName}
      onSend={(text) => client?.cmd(text)}
      onCall={(label: Label) => client?.cmd(`/human ${label}`)}
      onContinue={() => dispatch({ kind: 'continue' })}
      onNewGame={() => client?.cmd('/start')}
      onJoin={(token) => client?.cmd(`/start ${token}`)}
      onRestart={(p1, p2) => client?.cmd(`/restart ${p1} ${p2}`)}
      onInvite={() => client?.cmd('/invite')}
      onLeaderboard={() => client?.cmd('/leaderboard')}
      onLeave={() => { client?.cmd('/leave'); dispatch({ kind: 'reset' }); }}
      onSetName={(n) => client?.cmd(`/setname ${n}`)}
      onSignOut={() => {
        client?.disconnect();
        clearToken();
        setClient(null);
        dispatch({ kind: 'reset' });
        setScreen('login');
      }}
    />
  );
}
