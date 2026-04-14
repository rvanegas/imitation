import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, View, Linking } from 'react-native';
import { ImitationClient, ServerMessage } from './src/ws';
import { getToken, saveToken, clearToken } from './src/store';
import LoginScreen from './src/screens/LoginScreen';
import GameScreen, { ChatMessage } from './src/screens/GameScreen';

type Screen = 'loading' | 'login' | 'game';

let msgCounter = 0;
function nextId(): string { return String(++msgCounter); }

function parseInviteToken(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^imitation:\/\/join\/(\d+)$/);
  return match?.[1] ?? null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [client, setClient] = useState<ImitationClient | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

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
    } else if (msg.type === 'msg') {
      setMessages(prev => [...prev, { id: nextId(), text: msg.text, incoming: true }]);
    }
  }

  function handleAuthenticated(c: ImitationClient, name: string) {
    c.setMessageHandler((msg) => handleServerMessage(msg, c));
    setClient(c);
    setPlayerName(name);
    setMessages([]);
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
      client={client!}
      name={playerName}
      messages={messages}
      onSend={(text) => setMessages(prev => [...prev, { id: nextId(), text, incoming: false }])}
      onSignOut={() => {
        client?.disconnect();
        clearToken();
        setClient(null);
        setMessages([]);
        setScreen('login');
      }}
    />
  );
}
