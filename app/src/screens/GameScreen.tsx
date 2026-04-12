import React, { useState, useRef, useEffect, memo } from 'react';
import {
  View, Text, TextInput, Button, Pressable, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { ImitationClient } from '../ws';

export interface ChatMessage {
  id: string;
  text: string;
  incoming: boolean;
}

interface Props {
  client: ImitationClient;
  name: string;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onSignOut: () => void;
}

const Bubble = memo(({ item }: { item: ChatMessage }) => (
  <View style={[styles.bubble, item.incoming ? styles.incoming : styles.outgoing]}>
    <Text style={[styles.bubbleText, !item.incoming && styles.bubbleTextOut]}>{item.text}</Text>
  </View>
));

export default function GameScreen({ client, name, messages, onSend, onSignOut }: Props) {
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    client.cmd(text);
    setInput('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.headerRow}>
        <Text style={styles.header}>Playing as {name}</Text>
        <Pressable onPress={onSignOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => <Bubble item={item} />}
        style={styles.list}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          returnKeyType="send"
          placeholder="Type a message or /command"
        />
        <Button title="Send" onPress={send} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, paddingTop: 56 },
  headerRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 8, paddingHorizontal: 12 },
  header:         { flex: 1, textAlign: 'center', fontWeight: '600' },
  signOut:        { fontSize: 13, color: '#007aff' },
  list:           { flex: 1, paddingHorizontal: 12 },
  bubble:         { borderRadius: 12, padding: 10, marginVertical: 4, maxWidth: '80%' },
  incoming:       { backgroundColor: '#e5e5ea', alignSelf: 'flex-start' },
  outgoing:       { backgroundColor: '#007aff', alignSelf: 'flex-end' },
  bubbleText:     { fontSize: 16, color: '#000' },
  bubbleTextOut:  { color: '#fff' },
  inputRow:       { flexDirection: 'row', padding: 8, gap: 8, alignItems: 'center' },
  input:          { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16 },
});
