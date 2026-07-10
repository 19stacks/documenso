import { prisma } from '..';
import { seedUser } from '../seed/users';

async function main() {
  const email = process.env.WIZE_ADMIN_EMAIL;
  const password = process.env.WIZE_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('ERROR: WIZE_ADMIN_EMAIL and WIZE_ADMIN_PASSWORD must be set in .env or .env.local');
    process.exit(1);
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (existingUser) {
    console.info(`Admin user already exists: ${email}`);
    return;
  }

  console.info(`Creating admin user: ${email}`);

  const result = await seedUser({
    name: 'Wize Admin',
    email,
    password,
    isAdmin: true,
  });

  console.info(`Admin user created. User ID: ${result.user.id}`);
}

main()
  .catch((error) => {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  })
  .finally(() => {
    return prisma.$disconnect();
  });
