import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ImitationClient, ServerMessage } from './src/ws';
import { getToken, saveToken } from './src/store';
import LoginScreen from './src/screens/LoginScreen';
import GameScreen, { ChatMessage } from './src/screens/GameScreen';

type Screen = 'loading' | 'login' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [client, setClient] = useState<ImitationClient | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    tryAutoLogin();
  }, []);

  function makeClient(onMsg: (msg: ServerMessage) => void): ImitationClient {
    return new ImitationClient(onMsg, () => {
      setScreen('loading');
      setTimeout(tryAutoLogin, 2000);
    });
  }

  async function tryAutoLogin() {
    const token = await getToken();
    if (!token) { setScreen('login'); return; }

    const c = makeClient((msg) => handleServerMessage(msg, c));
    c.connect(() => c.login(token));
  }

  function handleServerMessage(msg: ServerMessage, c: ImitationClient) {
    if (msg.type === 'ready') {
      if (msg.token) saveToken(msg.token);
      setPlayerName(msg.name);
      setClient(c);
      setScreen('game');
    } else if (msg.type === 'msg') {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: msg.text, incoming: true }]);
    }
  }

  function handleAuthenticated(c: ImitationClient, name: string) {
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
      onSend={(text) => setMessages(prev => [...prev, { id: Date.now().toString(), text, incoming: false }])}
    />
  );
}
