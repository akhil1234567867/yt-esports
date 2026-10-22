# Features and User Stories

This document converts the provided feature list into actionable user stories with acceptance criteria.

## 1. Notifications (Follow, Likes, Comments, Team Invites)

User Story:
- As a user, I want to receive in-app notifications for follows, likes, comments, and team invites so that I can stay informed about activity relevant to me.

Acceptance Criteria:
- Notifications appear in a notifications center accessible from the header.
- Each notification shows type (follow, like, comment, invite), source user/team, timestamp, and a short message.
- Unread notifications are visually distinct and count is shown on the notifications icon.
- Clicking a notification navigates to the relevant content (profile, post, or team page) and marks it read.
- Users can mark all notifications as read or clear individual notifications.

## 2. In-app Messaging (Player and Team Chat)

User Story:
- As a user, I want to send and receive messages with players and teams so I can coordinate and chat.

Acceptance Criteria:
- Real-time 1:1 messaging between players.
- Team chat rooms where members can send messages visible to the team.
- Message list shows sender, timestamp, read receipts, and message text.
- Users can start a conversation from a profile or team page.

## 3. Groups / Clubs

User Story:
- As a user, I want to create and join groups (by game, city, college, or community) so I can connect with people who share interests.

Acceptance Criteria:
- Users can create groups with a name, description, and privacy setting (public/private).
- Groups have pages with member lists, posts, and events.
- Group admins can moderate posts and manage membership.

## 4. Search (Gamers, Teams, Posts, Tournaments)

User Story:
- As a user, I want to search for gamers, teams, posts, and tournaments so I can discover content and people.

Acceptance Criteria:
- A search input is available in the header.
- Results are categorized (players, teams, posts, tournaments) with quick filters.
- Search supports partial matches and sorting by relevance or recency.

## 5. Saved Posts

User Story:
- As a user, I want to save favourite clips and posts so I can view them later.

Acceptance Criteria:
- Each post/clip has a `Save` action.
- Saved items are accessible via a `Saved` page in the user profile.
- Users can remove items from saved list.

## 6. Content Moderation (Reports, Blocks, Admin Review)

User Story:
- As a user, I want to report abusive content and block users, and as an admin, I want to review reports so the community stays safe.

Acceptance Criteria:
- Users can report posts, comments, or users with predefined reason categories and optional text.
- Users can block other users; blocked users cannot message or interact with the blocker.
- Admin dashboard lists reports with context, reporter, timestamp, and status (new/in-review/resolved).
- Admins can take actions: remove content, warn, suspend, or ban user.

## 7. Profile Privacy

User Story:
- As a user, I want to control what profile data is public so I can protect my privacy.

Acceptance Criteria:
- Users can set profile visibility: Public / Friends-only / Private.
- Privacy settings affect who can see posts, activity, and profile details.
- Privacy changes are effective immediately and reflected in API responses.

---

Next steps:
- Convert these stories into issues and tasks in the project tracker.
- Optionally scaffold a minimal UI prototype (pick which features to mock first).
