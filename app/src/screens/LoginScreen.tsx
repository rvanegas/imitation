import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { ImitationClient } from '../ws';
import { saveToken } from '../store';

interface Props {
  onAuthenticated: (client: ImitationClient, name: string) => void;
}

export default function LoginScreen({ onAuthenticated }: Props) {
  const [inviteToken, setInviteToken] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  function handleConnect() {
    if (!inviteToken.trim() || !name.trim()) {
      Alert.alert('Both invite token and name are required.');
      return;
    }
    setLoading(true);

    const client = new ImitationClient(
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
        Alert.alert('Connection failed. Check the server address and invite token.');
      },
    );

    client.connect(() => client.bootstrap(inviteToken.trim(), name.trim()));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Imitation Game</Text>
      <TextInput
        style={styles.input}
        placeholder="Invite token"
        autoCapitalize="none"
        autoCorrect={false}
        value={inviteToken}
        onChangeText={setInviteToken}
      />
      <TextInput
        style={styles.input}
        placeholder="Your name"
        autoCapitalize="none"
        autoCorrect={false}
        value={name}
        onChangeText={setName}
      />
      {loading
        ? <ActivityIndicator />
        : <Button title="Join" onPress={handleConnect} />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title:     { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 16 },
  input:     { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
});
