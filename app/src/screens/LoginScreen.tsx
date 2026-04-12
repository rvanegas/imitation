import React, { useState } from 'react';
import { View, Text, TextInput, Button, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { ImitationClient } from '../ws';
import { saveToken } from '../store';

interface Props {
  onAuthenticated: (client: ImitationClient, name: string) => void;
}

type Mode = 'join' | 'link';

export default function LoginScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('join');
  const [sessionToken, setSessionToken] = useState('');
  const [linkToken, setLinkToken] = useState('');
  const [loading, setLoading] = useState(false);

  function makeClient(onMsg: (msg: any) => void, onDisconnect: () => void): ImitationClient {
    return new ImitationClient(
      async (msg) => {
        if (msg.type === 'ready') {
          if (msg.token) await saveToken(msg.token);
          setLoading(false);
          onAuthenticated(client, msg.name);
        } else if (msg.type === 'error') {
          setLoading(false);
          Alert.alert('Error', msg.text);
          client.disconnect();
        }
      },
      () => {
        setLoading(false);
        Alert.alert('Connection failed. Check the server address.');
      },
    );
  }

  // Hoist client so the handler can reference it.
  let client: ImitationClient;

  function handleJoin() {
    if (!sessionToken.trim()) { Alert.alert('Session token required.'); return; }
    setLoading(true);
    client = new ImitationClient(
      async (msg) => {
        if (msg.type === 'ready') {
          if (msg.token) await saveToken(msg.token);
          setLoading(false);
          onAuthenticated(client, msg.name);
        } else if (msg.type === 'error') {
          setLoading(false);
          Alert.alert('Error', msg.text);
          client.disconnect();
        }
      },
      () => { setLoading(false); Alert.alert('Connection failed. Check the server address.'); },
    );
    client.connect(() => client.bootstrap(sessionToken.trim()));
  }

  function handleLink() {
    if (!linkToken.trim()) { Alert.alert('Link token required.'); return; }
    setLoading(true);
    client = new ImitationClient(
      async (msg) => {
        if (msg.type === 'ready') {
          if (msg.token) await saveToken(msg.token);
          setLoading(false);
          onAuthenticated(client, msg.name);
        } else if (msg.type === 'error') {
          setLoading(false);
          Alert.alert('Error', msg.text);
          client.disconnect();
        }
      },
      () => { setLoading(false); Alert.alert('Connection failed. Check the server address.'); },
    );
    client.connect(() => client.link(linkToken.trim().toUpperCase()));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Imitation Game</Text>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, mode === 'join' && styles.tabActive]}
          onPress={() => setMode('join')}
        >
          <Text style={[styles.tabText, mode === 'join' && styles.tabTextActive]}>Join game</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === 'link' && styles.tabActive]}
          onPress={() => setMode('link')}
        >
          <Text style={[styles.tabText, mode === 'link' && styles.tabTextActive]}>Link Telegram</Text>
        </Pressable>
      </View>

      {mode === 'join' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Session token"
            autoCapitalize="none"
            autoCorrect={false}
            value={sessionToken}
            onChangeText={setSessionToken}
          />
          {loading ? <ActivityIndicator /> : <Button title="Join" onPress={handleJoin} />}
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Link token (from /link in Telegram)"
            autoCapitalize="characters"
            autoCorrect={false}
            value={linkToken}
            onChangeText={setLinkToken}
          />
          {loading ? <ActivityIndicator /> : <Button title="Link account" onPress={handleLink} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title:     { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  tabs:      { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#007aff', overflow: 'hidden', marginBottom: 4 },
  tab:       { flex: 1, paddingVertical: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#007aff' },
  tabText:   { color: '#007aff', fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  input:     { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
});
